#include "plugmesh/registration_client.h"

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <nlohmann/json.hpp>

#include <iostream>
#include <sstream>
#include <thread>

int main() {
  using Server = websocketpp::server<websocketpp::config::asio>;
  using Json = nlohmann::json;
  Server server;
  server.clear_access_channels(websocketpp::log::alevel::all);
  server.clear_error_channels(websocketpp::log::elevel::all);
  server.init_asio();
  server.set_message_handler([&server](websocketpp::connection_hdl handle, Server::message_ptr message) {
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
  if (endpoint_error || port == 0) {
    std::cerr << "unable to read test server port\n";
    return 1;
  }
  server.start_accept();
  std::thread server_thread([&server] { server.run(); });

  plugmesh::RegistrationResult result;
  std::string error;
  std::ostringstream worker_url;
  worker_url << "http://127.0.0.1:" << port;
  const bool registered = plugmesh::register_server(worker_url.str(), "one-time-code", "test-server", result, error);
  if (server_thread.joinable()) server_thread.join();
  if (!registered || result.server_id != "server-1" || result.access_token != "long-lived-token" || result.protocol_version != 1) {
    std::cerr << "registration client smoke failed: " << error << '\n';
    return 1;
  }
  std::cout << "registration client smoke test passed\n";
  return 0;
}
