#include "plugmesh/control_client.h"
#include "plugmesh/control_protocol.h"
#include "plugmesh/plugin_manager.h"

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>

int main() {
  using Server = websocketpp::server<websocketpp::config::asio>;
  Server server;
  server.clear_access_channels(websocketpp::log::alevel::all);
  server.clear_error_channels(websocketpp::log::elevel::all);
  server.init_asio();
  server.set_reuse_addr(true);

  std::mutex mutex;
  std::condition_variable condition;
  bool request_valid = false;
  bool registration_received = false;
  server.set_validate_handler([&](websocketpp::connection_hdl handle) {
    const auto connection = server.get_con_from_hdl(handle);
    std::lock_guard lock(mutex);
    request_valid = connection->get_resource() == "/control/connect?serverId=server-1" && connection->get_request_header("Authorization") == "Bearer control-token";
    return request_valid;
  });
  server.set_open_handler([&](websocketpp::connection_hdl handle) {
    const auto hello = plugmesh::make_control_frame("hello", "server-1");
    websocketpp::lib::error_code error;
    server.send(handle, plugmesh::serialize_control_frame(hello), websocketpp::frame::opcode::text, error);
  });
  server.set_message_handler([&](websocketpp::connection_hdl, Server::message_ptr message) {
    plugmesh::ControlFrame frame;
    std::string error;
    if (!plugmesh::parse_control_frame(message->get_payload(), frame, error) || frame.type != "server.register" || frame.server_id != "server-1" || !frame.payload.value("manifests", plugmesh::Json::array()).is_array()) return;
    {
      std::lock_guard lock(mutex);
      registration_received = true;
    }
    condition.notify_all();
  });

  server.listen(0);
  websocketpp::lib::error_code endpoint_error;
  const auto port = server.get_local_endpoint(endpoint_error).port();
  if (endpoint_error || port == 0) {
    std::cerr << "unable to read control test server port\n";
    return 1;
  }
  server.start_accept();
  std::thread server_thread([&] { server.run(); });

  std::ostringstream worker_url;
  worker_url << "http://127.0.0.1:" << port;
  plugmesh::ServerConfig config;
  config.worker_url = worker_url.str();
  config.server_id = "server-1";
  config.access_token = "control-token";
  plugmesh::PluginManager plugins;
  plugmesh::ControlClient client(std::move(config), plugins);
  bool client_result = false;
  std::string client_error;
  std::thread client_thread([&] { client_result = client.run(client_error); });

  bool completed = false;
  {
    std::unique_lock lock(mutex);
    completed = condition.wait_for(lock, std::chrono::seconds(5), [&] { return registration_received; });
  }
  client.stop();
  if (client_thread.joinable()) client_thread.join();
  server.get_io_service().post([&] { server.stop(); });
  if (server_thread.joinable()) server_thread.join();

  if (!completed || !request_valid || !registration_received || !client_result) {
    std::cerr << "plain control client smoke failed: " << client_error << '\n';
    return 1;
  }
  std::cout << "plain control client smoke test passed\n";
  return 0;
}
