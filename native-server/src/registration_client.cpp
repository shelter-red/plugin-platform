#include "plugmesh/registration_client.h"

#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>

#include <asio/ssl/context.hpp>
#include <asio/ssl/rfc2818_verification.hpp>
#include <nlohmann/json.hpp>
#include <openssl/ssl.h>

#include <type_traits>

namespace plugmesh {

namespace {

using PlainClient = websocketpp::client<websocketpp::config::asio_client>;
using TlsClient = websocketpp::client<websocketpp::config::asio_tls_client>;
using TlsContext = websocketpp::lib::shared_ptr<websocketpp::lib::asio::ssl::context>;
using Json = nlohmann::json;

TlsContext tls_init(websocketpp::connection_hdl) {
  auto context = websocketpp::lib::make_shared<websocketpp::lib::asio::ssl::context>(websocketpp::lib::asio::ssl::context::sslv23);
  context->set_options(websocketpp::lib::asio::ssl::context::default_workarounds | websocketpp::lib::asio::ssl::context::no_sslv2 | websocketpp::lib::asio::ssl::context::no_sslv3 | websocketpp::lib::asio::ssl::context::single_dh_use);
  context->set_default_verify_paths();
  context->set_verify_mode(websocketpp::lib::asio::ssl::verify_peer);
  return context;
}

std::string endpoint(std::string worker_url) {
  if (worker_url.rfind("https://", 0) == 0) worker_url.replace(0, 8, "wss://");
  else if (worker_url.rfind("http://", 0) == 0) worker_url.replace(0, 7, "ws://");
  while (!worker_url.empty() && worker_url.back() == '/') worker_url.pop_back();
  return worker_url + "/control/register";
}

}  // namespace

template <typename Client>
bool register_with_client(const std::string& worker_url, const std::string& code, const std::string& name, RegistrationResult& result, std::string& error) {
  Client client;
  client.clear_access_channels(websocketpp::log::alevel::all);
  client.clear_error_channels(websocketpp::log::elevel::all);
  client.init_asio();
  if constexpr (std::is_same_v<Client, TlsClient>) {
    client.set_tls_init_handler(&tls_init);
    client.set_socket_init_handler([&client](websocketpp::connection_hdl handle, asio::ssl::stream<asio::ip::tcp::socket>& socket) {
      const auto connection = client.get_con_from_hdl(handle);
      const auto host = connection->get_uri()->get_host();
      socket.set_verify_callback(asio::ssl::rfc2818_verification(host));
      if (!host.empty()) SSL_set_tlsext_host_name(socket.native_handle(), host.c_str());
    });
  }
  bool success = false;
  client.set_open_handler([&client, &code, &name](websocketpp::connection_hdl handle) {
    websocketpp::lib::error_code send_error;
    client.send(handle, Json{{"code", code}, {"name", name}}.dump(), websocketpp::frame::opcode::text, send_error);
  });
  client.set_message_handler([&client, &result, &error, &success](websocketpp::connection_hdl handle, typename Client::message_ptr message) {
    try {
      const auto payload = Json::parse(message->get_payload());
      if (!payload.value("ok", false)) {
        error = payload.value("error", std::string("server registration failed"));
      } else {
        result.server_id = payload.at("serverId").template get<std::string>();
        result.access_token = payload.at("accessToken").template get<std::string>();
        result.protocol_version = payload.value("protocolVersion", 0u);
        success = !result.server_id.empty() && !result.access_token.empty() && result.protocol_version == 1;
        if (!success) error = "registration response is incomplete";
      }
    } catch (const Json::exception&) {
      error = "invalid registration response";
    }
    websocketpp::lib::error_code close_error;
    client.close(handle, websocketpp::close::status::normal, "registration complete", close_error);
  });
  client.set_fail_handler([&client, &error](websocketpp::connection_hdl) {
    if (error.empty()) error = "registration connection failed";
    client.stop();
  });
  client.set_close_handler([&client](websocketpp::connection_hdl) { client.stop(); });

  websocketpp::lib::error_code connection_error;
  const auto connection = client.get_connection(endpoint(worker_url), connection_error);
  if (connection_error) {
    error = connection_error.message();
    return false;
  }
  client.connect(connection);
  client.run();
  if (!success && error.empty()) error = "registration did not complete";
  return success;
}

bool register_server(const std::string& worker_url, const std::string& code, const std::string& name, RegistrationResult& result, std::string& error) {
  if (worker_url.empty() || code.empty() || name.empty()) {
    error = "worker URL, registration code and server name are required";
    return false;
  }
  if (worker_url.rfind("https://", 0) == 0) return register_with_client<TlsClient>(worker_url, code, name, result, error);
  if (worker_url.rfind("http://", 0) == 0) return register_with_client<PlainClient>(worker_url, code, name, result, error);
  error = "worker URL must use http:// or https://";
  return false;
}

}  // namespace plugmesh
