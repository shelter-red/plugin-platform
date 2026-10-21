#include "plugmesh/control_client.h"
#include "plugmesh/control_protocol.h"
#include "plugmesh/plugin_manager.h"

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/base64/base64.hpp>
#include <websocketpp/server.hpp>

#include <chrono>
#include <condition_variable>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <utility>
#include <vector>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: plugmesh-control-client-smoke <plugin-directory>\n";
    return 2;
  }
  using Server = websocketpp::server<websocketpp::config::asio>;
  Server server;
  server.clear_access_channels(websocketpp::log::alevel::all);
  server.clear_error_channels(websocketpp::log::elevel::all);
  server.init_asio();
  server.set_reuse_addr(true);

  std::mutex mutex;
  std::condition_variable condition;
  bool requests_valid = true;
  int validated_connections = 0;
  int registration_count = 0;
  bool stream_payload_valid = false;
  std::vector<std::string> stream_frames;
  server.set_validate_handler([&](websocketpp::connection_hdl handle) {
    const auto connection = server.get_con_from_hdl(handle);
    std::lock_guard lock(mutex);
    const auto valid = connection->get_resource() == "/control/connect?serverId=server-1" && connection->get_request_header("Authorization") == "Bearer control-token";
    requests_valid = requests_valid && valid;
    ++validated_connections;
    return valid;
  });
  server.set_open_handler([&](websocketpp::connection_hdl handle) {
    const auto hello = plugmesh::make_control_frame("hello", "server-1");
    websocketpp::lib::error_code error;
    server.send(handle, plugmesh::serialize_control_frame(hello), websocketpp::frame::opcode::text, error);
  });
  server.set_message_handler([&](websocketpp::connection_hdl handle, Server::message_ptr message) {
    plugmesh::ControlFrame frame;
    std::string error;
    if (!plugmesh::parse_control_frame(message->get_payload(), frame, error)) return;
    if (frame.type == "server.register" && frame.server_id == "server-1" && frame.payload.value("manifests", plugmesh::Json::array()).is_array()) {
      int current_registration_count = 0;
      {
        std::lock_guard lock(mutex);
        current_registration_count = ++registration_count;
      }
      condition.notify_all();
      if (current_registration_count == 1) {
        websocketpp::lib::error_code close_error;
        server.close(handle, websocketpp::close::status::going_away, "test reconnect", close_error);
      } else if (current_registration_count == 2) {
        auto request = plugmesh::make_control_frame("stream.open", "server-1", {{"streamId", "sse-1"}, {"method", "GET"}, {"path", "/events"}, {"headers", plugmesh::Json::object()}, {"body", ""}, {"bodyEncoding", "base64"}}, "sample.plugin");
        request.request_id = "sse-1";
        websocketpp::lib::error_code send_error;
        server.send(handle, plugmesh::serialize_control_frame(request), websocketpp::frame::opcode::text, send_error);
      }
      return;
    }
    if (frame.request_id != "sse-1" || (frame.type != "request.open" && frame.type != "stream.chunk" && frame.type != "stream.close")) return;
    {
      std::lock_guard lock(mutex);
      stream_frames.push_back(frame.type);
      if (frame.type == "request.open") {
        stream_payload_valid = frame.payload.value("status", 0) == 200 && frame.payload.value("headers", plugmesh::Json::object()).value("content-type", "") == "text/event-stream; charset=utf-8";
      } else if (frame.type == "stream.chunk") {
        stream_payload_valid = stream_payload_valid && websocketpp::base64_decode(frame.payload.value("data", "")) == "data: sample-plugin\n\n";
      }
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
  std::string plugin_error;
  if (!plugins.discover(argv[1], plugin_error) || !plugins.enable("sample.plugin", plugin_error)) {
    server.get_io_service().post([&] { server.stop(); });
    if (server_thread.joinable()) server_thread.join();
    std::cerr << "control test plugin setup failed: " << plugin_error << '\n';
    return 1;
  }
  plugmesh::ControlClient client(std::move(config), plugins);
  bool client_result = false;
  std::string client_error;
  std::thread client_thread([&] { client_result = client.run(client_error); });

  bool completed = false;
  {
    std::unique_lock lock(mutex);
    completed = condition.wait_for(lock, std::chrono::seconds(8), [&] { return registration_count >= 2 && stream_frames.size() >= 3 && stream_frames.back() == "stream.close"; });
  }
  client.stop();
  if (client_thread.joinable()) client_thread.join();
  server.get_io_service().post([&] { server.stop(); });
  if (server_thread.joinable()) server_thread.join();

  if (!completed || !requests_valid || validated_connections < 2 || registration_count < 2 || !stream_payload_valid || stream_frames != std::vector<std::string>{"request.open", "stream.chunk", "stream.close"} || !client_result) {
    std::cerr << "plain control client reconnect smoke failed: " << client_error << '\n';
    return 1;
  }
  std::cout << "plain control client reconnect smoke test passed\n";
  return 0;
}
