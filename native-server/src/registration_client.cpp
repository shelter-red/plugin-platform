#include "plugmesh/registration_client.h"
#include "plugmesh/server_config.h"
#include "plugmesh/tls_support.h"

#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>

#include <nlohmann/json.hpp>
#include <openssl/err.h>

#include <type_traits>
#include <cstdlib>

namespace plugmesh {

namespace {

using PlainClient = websocketpp::client<websocketpp::config::asio_client>;
using TlsClient = websocketpp::client<websocketpp::config::asio_tls_client>;
using Json = nlohmann::json;

std::string endpoint(std::string worker_url) {
  if (worker_url.rfind("https://", 0) == 0) worker_url.replace(0, 8, "wss://");
  else if (worker_url.rfind("http://", 0) == 0) worker_url.replace(0, 7, "ws://");
  while (!worker_url.empty() && worker_url.back() == '/') worker_url.pop_back();
  return worker_url + "/control/register";
}

}  // namespace

template <typename Client>
bool register_with_client(const std::string& worker_url, const std::string& code, const std::string& name, RegistrationResult& result, std::string& error, RegistrationFailure& failure) {
  Client client;
  client.clear_access_channels(websocketpp::log::alevel::all);
  client.clear_error_channels(websocketpp::log::elevel::all);
  if (std::getenv("PLUGMESH_DEBUG_TLS") != nullptr) client.set_error_channels(websocketpp::log::elevel::all);
  client.init_asio();
  if constexpr (std::is_same_v<Client, TlsClient>) {
    const websocketpp::uri uri(endpoint(worker_url));
    const auto host = uri.get_host();
    client.set_tls_init_handler([](websocketpp::connection_hdl) { return make_tls_context(); });
    client.set_socket_init_handler([host](websocketpp::connection_hdl, asio::ssl::stream<asio::ip::tcp::socket>& socket) { configure_tls_socket(socket, host); });
  }
  bool success = false;
  client.set_open_handler([&client, &code, &name](websocketpp::connection_hdl handle) {
    websocketpp::lib::error_code send_error;
    client.send(handle, Json{{"code", code}, {"name", name}}.dump(), websocketpp::frame::opcode::text, send_error);
  });
  client.set_message_handler([&client, &result, &error, &success, &failure](websocketpp::connection_hdl handle, typename Client::message_ptr message) {
    try {
      const auto payload = Json::parse(message->get_payload());
      if (!payload.value("ok", false)) {
        error = payload.value("error", std::string("server registration failed"));
        failure = payload.value("code", std::string()) == "registration_code_invalid_or_expired"
            ? RegistrationFailure::code_invalid_or_expired
            : RegistrationFailure::invalid_response;
      } else {
        result.server_id = payload.at("serverId").template get<std::string>();
        result.access_token = payload.at("accessToken").template get<std::string>();
        result.protocol_version = payload.value("protocolVersion", 0u);
        success = !result.server_id.empty() && !result.access_token.empty() && result.protocol_version == 1;
        if (!success) {
          error = "registration response is incomplete";
          failure = RegistrationFailure::invalid_response;
        }
      }
    } catch (const Json::exception&) {
      error = "invalid registration response";
      failure = RegistrationFailure::invalid_response;
    }
    websocketpp::lib::error_code close_error;
    client.close(handle, websocketpp::close::status::normal, "registration complete", close_error);
  });
  client.set_fail_handler([&client, &error, &failure](websocketpp::connection_hdl handle) {
    if (error.empty()) {
      const auto connection = client.get_con_from_hdl(handle);
      error = "registration connection failed: " + connection->get_ec().message();
      unsigned long openssl_error = 0;
      while ((openssl_error = ERR_get_error()) != 0) {
        char detail[256]{};
        ERR_error_string_n(openssl_error, detail, sizeof(detail));
        error += "; " + std::string(detail);
      }
    }
    if constexpr (std::is_same_v<Client, TlsClient>) {
      const auto connection = client.get_con_from_hdl(handle);
      const auto connection_error = connection->get_ec();
      const auto tls_handshake_failed = websocketpp::transport::asio::socket::make_error_code(websocketpp::transport::asio::socket::error::tls_handshake_failed);
      const auto tls_handshake_timeout = websocketpp::transport::asio::socket::make_error_code(websocketpp::transport::asio::socket::error::tls_handshake_timeout);
      failure = connection_error == tls_handshake_failed || connection_error == tls_handshake_timeout ? RegistrationFailure::tls_failed : RegistrationFailure::connection_failed;
    } else {
      failure = RegistrationFailure::connection_failed;
    }
    client.stop();
  });
  client.set_close_handler([&client](websocketpp::connection_hdl) { client.stop(); });

  websocketpp::lib::error_code connection_error;
  const auto connection = client.get_connection(endpoint(worker_url), connection_error);
  if (connection_error) {
    error = connection_error.message();
    failure = RegistrationFailure::connection_failed;
    return false;
  }
  client.connect(connection);
  client.run();
  if (!success && error.empty()) {
    error = "registration did not complete";
    failure = RegistrationFailure::connection_failed;
  }
  return success;
}

const char* registration_failure_code(RegistrationFailure failure) {
  switch (failure) {
    case RegistrationFailure::invalid_input: return "registration_invalid_input";
    case RegistrationFailure::code_invalid_or_expired: return "registration_code_invalid_or_expired";
    case RegistrationFailure::connection_failed: return "registration_connection_failed";
    case RegistrationFailure::tls_failed: return "registration_tls_failed";
    case RegistrationFailure::invalid_response: return "registration_invalid_response";
    case RegistrationFailure::none: return "registration_failed";
  }
  return "registration_failed";
}

bool register_server(const std::string& worker_url, const std::string& code, const std::string& name, RegistrationResult& result, std::string& error, RegistrationFailure* failure) {
  RegistrationFailure resolved_failure = RegistrationFailure::none;
  if (worker_url.empty() || code.empty() || name.empty()) {
    error = "worker URL, registration code and server name are required";
    resolved_failure = RegistrationFailure::invalid_input;
    if (failure) *failure = resolved_failure;
    return false;
  }
  if (!validate_worker_url(worker_url, error)) {
    resolved_failure = RegistrationFailure::invalid_input;
  } else if (worker_url.rfind("https://", 0) == 0) {
    const auto success = register_with_client<TlsClient>(worker_url, code, name, result, error, resolved_failure);
    if (failure) *failure = resolved_failure;
    return success;
  } else if (worker_url.rfind("http://", 0) == 0) {
    const auto success = register_with_client<PlainClient>(worker_url, code, name, result, error, resolved_failure);
    if (failure) *failure = resolved_failure;
    return success;
  } else {
    error = "worker URL must use http:// or https://";
    resolved_failure = RegistrationFailure::invalid_input;
  }
  if (failure) *failure = resolved_failure;
  return false;
}

}  // namespace plugmesh
