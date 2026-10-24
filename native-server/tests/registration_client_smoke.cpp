#include "plugmesh/registration_client.h"

#include <websocketpp/config/asio.hpp>
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <asio/ssl/context.hpp>
#include <nlohmann/json.hpp>

#include <cstdlib>
#include <iostream>
#include <string>
#include <thread>

namespace {

using Json = nlohmann::json;
using PlainServer = websocketpp::server<websocketpp::config::asio>;
using TlsServer = websocketpp::server<websocketpp::config::asio_tls>;

void trust_certificate(const std::string& certificate) {
#ifdef _WIN32
  _putenv_s("SSL_CERT_FILE", certificate.c_str());
#else
  setenv("SSL_CERT_FILE", certificate.c_str(), 1);
#endif
}

bool run_plain_registration() {
  PlainServer server;
  server.clear_access_channels(websocketpp::log::alevel::all);
  server.clear_error_channels(websocketpp::log::elevel::all);
  server.init_asio();
  server.set_message_handler([&server](websocketpp::connection_hdl handle, PlainServer::message_ptr message) {
    try {
      const auto request = Json::parse(message->get_payload());
      if (request.at("code").get<std::string>() != "one-time-code" || request.at("name").get<std::string>() != "test-server") return;
      server.send(handle, Json{{"ok", true}, {"serverId", "server-1"}, {"accessToken", "long-lived-token"}, {"protocolVersion", 1}}.dump(), websocketpp::frame::opcode::text);
    } catch (...) {
      websocketpp::lib::error_code error;
      server.send(handle, Json{{"ok", false}, {"error", "invalid request"}}.dump(), websocketpp::frame::opcode::text, error);
    }
  });
  server.set_close_handler([&server](websocketpp::connection_hdl) { server.stop(); });
  server.listen(0);
  websocketpp::lib::error_code endpoint_error;
  const auto port = server.get_local_endpoint(endpoint_error).port();
  if (endpoint_error || port == 0) return false;
  server.start_accept();
  std::thread server_thread([&server] { server.run(); });

  plugmesh::RegistrationResult result;
  plugmesh::RegistrationFailure failure = plugmesh::RegistrationFailure::none;
  std::string error;
  const auto registered = plugmesh::register_server("http://127.0.0.1:" + std::to_string(port), "one-time-code", "test-server", result, error, &failure);
  if (server_thread.joinable()) server_thread.join();
  return registered && failure == plugmesh::RegistrationFailure::none && result.server_id == "server-1" && result.access_token == "long-lived-token" && result.protocol_version == 1;
}

bool run_tls_registration(const std::string& certificate, const std::string& private_key, const std::string& host, bool accept, plugmesh::RegistrationFailure expected_failure) {
  TlsServer server;
  server.clear_access_channels(websocketpp::log::alevel::all);
  server.clear_error_channels(websocketpp::log::elevel::all);
  server.init_asio();
  server.set_tls_init_handler([&certificate, &private_key](websocketpp::connection_hdl) {
    auto context = websocketpp::lib::make_shared<websocketpp::lib::asio::ssl::context>(websocketpp::lib::asio::ssl::context::tls_server);
    context->set_options(websocketpp::lib::asio::ssl::context::default_workarounds);
    context->use_certificate_chain_file(certificate);
    context->use_private_key_file(private_key, websocketpp::lib::asio::ssl::context::pem);
    return context;
  });
  server.set_message_handler([&server, accept](websocketpp::connection_hdl handle, TlsServer::message_ptr) {
    const auto response = accept
        ? Json{{"ok", true}, {"serverId", "tls-server"}, {"accessToken", "tls-token"}, {"protocolVersion", 1}}
        : Json{{"ok", false}, {"error", "Registration code is invalid or expired"}, {"code", "registration_code_invalid_or_expired"}};
    websocketpp::lib::error_code error;
    server.send(handle, response.dump(), websocketpp::frame::opcode::text, error);
  });
  server.listen(0);
  websocketpp::lib::error_code endpoint_error;
  const auto port = server.get_local_endpoint(endpoint_error).port();
  if (endpoint_error || port == 0) return false;
  server.start_accept();
  std::thread server_thread([&server] { server.run(); });

  plugmesh::RegistrationResult result;
  plugmesh::RegistrationFailure failure = plugmesh::RegistrationFailure::none;
  std::string error;
  const auto registered = plugmesh::register_server("https://" + host + ":" + std::to_string(port), "one-time-code", "test-server", result, error, &failure);
  server.stop_listening();
  server.stop();
  if (server_thread.joinable()) server_thread.join();

  if (accept && expected_failure == plugmesh::RegistrationFailure::none) {
    return registered && failure == expected_failure && result.server_id == "tls-server" && result.access_token == "tls-token" && result.protocol_version == 1;
  }
  return !registered && failure == expected_failure && !error.empty();
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: plugmesh-registration-client-smoke <certificate> <private-key>\n";
    return 2;
  }
  trust_certificate(argv[1]);

  plugmesh::RegistrationResult rejected_result;
  plugmesh::RegistrationFailure rejected_failure = plugmesh::RegistrationFailure::none;
  std::string rejected_error;
  if (plugmesh::register_server("http://example.com", "one-time-code", "test-server", rejected_result, rejected_error, &rejected_failure) || rejected_failure != plugmesh::RegistrationFailure::invalid_input) {
    std::cerr << "insecure remote worker URL was accepted or misclassified\n";
    return 1;
  }
  if (!run_plain_registration()) {
    std::cerr << "plain registration client smoke failed\n";
    return 1;
  }
  if (!run_tls_registration(argv[1], argv[2], "localhost", true, plugmesh::RegistrationFailure::none)) {
    std::cerr << "TLS registration client smoke failed\n";
    return 1;
  }
  if (!run_tls_registration(argv[1], argv[2], "localhost", false, plugmesh::RegistrationFailure::code_invalid_or_expired)) {
    std::cerr << "registration rejection was misclassified\n";
    return 1;
  }
  if (!run_tls_registration(argv[1], argv[2], "127.0.0.1", true, plugmesh::RegistrationFailure::tls_failed)) {
    std::cerr << "TLS hostname failure was not rejected or was misclassified\n";
    return 1;
  }
  std::cout << "registration client smoke test passed\n";
  return 0;
}
