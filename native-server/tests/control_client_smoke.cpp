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
  if (argc != 3) {
    std::cerr << "usage: plugmesh-control-client-smoke <plugin-host> <plugin-directory>\n";
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
  int sync_context_count = 0;
  int sync_result_count = 0;
  bool sync_result_checked = false;
  int health_response_count = 0;
  int stale_response_count = 0;
  int list_response_count = 0;
  bool list_payload_valid = false;
  bool http_payload_valid = false;
  bool stream_payload_valid = false;
  bool file_payload_valid = false;
  bool cancellable_stream_payload_valid = false;
  bool cancellable_started = false;
  bool cancellable_chunk_valid = false;
  bool cancellable_health_valid = false;
  int cancellable_health_response_count = 0;
  std::vector<std::string> http_frames;
  std::vector<std::string> stream_frames;
  std::vector<std::string> file_frames;
  std::vector<std::string> cancellable_frames;
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
        auto stale = plugmesh::make_control_frame("plugin.health", "server-1", plugmesh::Json::object(), "sample.plugin");
        stale.request_id = "stale-health";
        stale.timestamp = "2000-01-01T00:00:00.000Z";
        auto health = plugmesh::make_control_frame("plugin.health", "server-1", plugmesh::Json::object(), "sample.plugin");
        health.request_id = "health-1";
        auto list = plugmesh::make_control_frame("plugin.list", "server-1");
        list.request_id = "list-1";
        auto request = plugmesh::make_control_frame("request.open", "server-1", {{"method", "GET"}, {"path", "/cookie"}, {"headers", plugmesh::Json::object()}, {"body", ""}, {"bodyEncoding", "base64"}, {"mode", "http"}}, "sample.plugin");
        request.request_id = "http-1";
        websocketpp::lib::error_code send_error;
        server.send(handle, plugmesh::serialize_control_frame(stale), websocketpp::frame::opcode::text, send_error);
        const auto serialized_health = plugmesh::serialize_control_frame(health);
        server.send(handle, serialized_health, websocketpp::frame::opcode::text, send_error);
        server.send(handle, serialized_health, websocketpp::frame::opcode::text, send_error);
        server.send(handle, plugmesh::serialize_control_frame(list), websocketpp::frame::opcode::text, send_error);
        server.send(handle, plugmesh::serialize_control_frame(request), websocketpp::frame::opcode::text, send_error);
        auto sync = plugmesh::make_control_frame("server.sync", "server-1");
        sync.request_id = "sync-1";
        server.send(handle, plugmesh::serialize_control_frame(sync), websocketpp::frame::opcode::text, send_error);
      } else if (current_registration_count == 3) {
        {
          std::lock_guard lock(mutex);
          if (frame.payload.value("syncRequestId", "") == "sync-1") ++sync_context_count;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(100));
        {
          std::lock_guard lock(mutex);
          sync_result_checked = sync_result_count == 0;
        }
      }
      return;
    }
    if (frame.type == "server.result" && frame.request_id == "sync-1") {
      std::lock_guard lock(mutex);
      ++sync_result_count;
      condition.notify_all();
      return;
    }
    if (frame.type == "plugin.result") {
      std::lock_guard lock(mutex);
      if (frame.request_id == "health-1") ++health_response_count;
      if (frame.request_id == "stale-health") ++stale_response_count;
      if (frame.request_id == "list-1") {
        ++list_response_count;
        const auto manifests = frame.payload.value("manifests", plugmesh::Json::array());
        bool sample_found = false;
        bool cancellable_found = false;
        if (manifests.is_array()) {
          for (const auto& manifest : manifests) {
            if (manifest.value("id", "") == "sample.plugin") {
              sample_found = manifest.value("state", "") == "enabled" && manifest.value("healthPath", "") == "/health";
            }
            if (manifest.value("id", "") == "cancellable.plugin") {
              cancellable_found = manifest.value("abiVersion", "") == "4";
            }
          }
        }
        list_payload_valid = frame.payload.value("action", "") == "list" && frame.payload.value("ok", false) && manifests.is_array() && manifests.size() == 4 && sample_found && cancellable_found;
      }
      if (frame.request_id == "cancel-health") {
        ++cancellable_health_response_count;
        cancellable_health_valid = frame.plugin_id == "cancellable.plugin" && frame.payload.value("action", "") == "health" && frame.payload.value("ok", false) && frame.payload.value("status", 0) == 200;
      }
      condition.notify_all();
      return;
    }
    if (frame.request_id == "http-1") {
      std::lock_guard lock(mutex);
      http_frames.push_back(frame.type);
      if (frame.type == "request.open") {
        const auto headers = frame.payload.value("headers", plugmesh::Json::object());
        const auto cookies = headers.value("set-cookie", plugmesh::Json::array());
        http_payload_valid = frame.payload.value("status", 0) == 200 && cookies.is_array() && cookies.size() == 2 && cookies[0] == "plugmesh_e2e=1; Path=/" && cookies[1] == "plugmesh_second=2; Path=/";
      } else if (frame.type == "request.chunk") {
        http_payload_valid = http_payload_valid && websocketpp::base64_decode(frame.payload.value("data", "")) == "cookie-set";
      } else if (frame.type == "request.close") {
        auto request = plugmesh::make_control_frame("stream.open", "server-1", {{"streamId", "sse-1"}, {"method", "GET"}, {"path", "/events"}, {"headers", plugmesh::Json::object()}, {"body", ""}, {"bodyEncoding", "base64"}}, "sample.plugin");
        request.request_id = "sse-1";
        websocketpp::lib::error_code send_error;
        server.send(handle, plugmesh::serialize_control_frame(request), websocketpp::frame::opcode::text, send_error);
      }
      condition.notify_all();
      return;
    }
    if (frame.request_id == "sse-1") {
      std::lock_guard lock(mutex);
      stream_frames.push_back(frame.type);
      if (frame.type == "request.open") {
        stream_payload_valid = frame.payload.value("status", 0) == 200 && frame.payload.value("headers", plugmesh::Json::object()).value("content-type", "") == "text/event-stream; charset=utf-8";
      } else if (frame.type == "stream.chunk") {
        stream_payload_valid = stream_payload_valid && websocketpp::base64_decode(frame.payload.value("data", "")) == "data: sample-plugin\n\n";
      } else if (frame.type == "stream.close") {
        auto request = plugmesh::make_control_frame("request.open", "server-1", {{"method", "GET"}, {"path", "/download"}, {"headers", plugmesh::Json::object()}, {"body", ""}, {"bodyEncoding", "base64"}, {"mode", "file"}}, "sample.plugin");
        request.request_id = "file-1";
        websocketpp::lib::error_code send_error;
        server.send(handle, plugmesh::serialize_control_frame(request), websocketpp::frame::opcode::text, send_error);
      }
      condition.notify_all();
      return;
    }
    if (frame.request_id == "file-1" && (frame.type == "request.open" || frame.type == "stream.chunk" || frame.type == "stream.close")) {
      std::lock_guard lock(mutex);
      file_frames.push_back(frame.type);
      if (frame.type == "request.open") {
        file_payload_valid = frame.payload.value("status", 0) == 200 && frame.payload.value("fileStream", false);
      } else if (frame.type == "stream.chunk") {
        file_payload_valid = file_payload_valid && websocketpp::base64_decode(frame.payload.value("data", "")) == "sample-file-stream";
      } else if (frame.type == "stream.close") {
        auto request = plugmesh::make_control_frame("stream.open", "server-1", {{"streamId", "cancel-sse"}, {"method", "GET"}, {"path", "/cancel-events"}, {"headers", plugmesh::Json::object()}, {"body", ""}, {"bodyEncoding", "base64"}}, "cancellable.plugin");
        request.request_id = "cancel-sse";
        websocketpp::lib::error_code send_error;
        server.send(handle, plugmesh::serialize_control_frame(request), websocketpp::frame::opcode::text, send_error);
      }
      condition.notify_all();
      return;
    }
    if (frame.request_id != "cancel-sse" || (frame.type != "request.open" && frame.type != "stream.chunk" && frame.type != "stream.close")) return;
    {
      std::lock_guard lock(mutex);
      cancellable_frames.push_back(frame.type);
      if (frame.type == "request.open") {
        cancellable_stream_payload_valid = frame.plugin_id == "cancellable.plugin" && frame.payload.value("status", 0) == 200 && frame.payload.value("headers", plugmesh::Json::object()).value("content-type", "") == "text/event-stream; charset=utf-8";
      } else if (frame.type == "stream.chunk") {
        const auto data = websocketpp::base64_decode(frame.payload.value("data", ""));
        if (data == "data: started\n\n") {
          // 插件已经真正跑起来并登记了流，此刻关闭才是稳定的取消时序；
          // 之前收到 request.open 就关闭会与插件启动赛跑，造成 CI 假失败。
          cancellable_started = true;
          auto close = plugmesh::make_control_frame("stream.close", "server-1", {{"streamId", "cancel-sse"}, {"reason", "Client disconnected"}}, "cancellable.plugin");
          close.request_id = "cancel-sse";
          websocketpp::lib::error_code send_error;
          server.send(handle, plugmesh::serialize_control_frame(close), websocketpp::frame::opcode::text, send_error);
        } else if (data == "data: cancelled\n\n") {
          cancellable_chunk_valid = true;
        } else {
          cancellable_stream_payload_valid = false;
        }
      } else if (frame.type == "stream.close") {
        auto health = plugmesh::make_control_frame("plugin.health", "server-1", plugmesh::Json::object(), "cancellable.plugin");
        health.request_id = "cancel-health";
        websocketpp::lib::error_code send_error;
        server.send(handle, plugmesh::serialize_control_frame(health), websocketpp::frame::opcode::text, send_error);
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
  plugins.set_host_executable(argv[1]);
  std::string plugin_error;
  if (!plugins.discover(argv[2], plugin_error) || !plugins.enable("sample.plugin", plugin_error) || !plugins.enable("cancellable.plugin", plugin_error)) {
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
    // 控制客户端在连接断开后固定等待 5 秒才重连（生产行为），用例本身就要耗掉 5 秒以上；
    // 原先的 8 秒上限在负载较高的 CI 机器上会假失败，这里放宽到 30 秒。
    completed = condition.wait_for(lock, std::chrono::seconds(30), [&] { return registration_count >= 3 && sync_result_checked && sync_context_count == 1 && sync_result_count == 0 && file_frames.size() >= 3 && file_frames.back() == "stream.close" && cancellable_frames.size() >= 3 && cancellable_frames.back() == "stream.close" && cancellable_health_response_count == 1 && cancellable_health_valid; });
  }
  client.stop();
  if (client_thread.joinable()) client_thread.join();
  server.get_io_service().post([&] { server.stop(); });
  if (server_thread.joinable()) server_thread.join();

  if (!completed || !requests_valid || validated_connections < 2 || registration_count < 3 || sync_context_count != 1 || !sync_result_checked || sync_result_count != 0 || health_response_count != 1 || stale_response_count != 0 || list_response_count != 1 || !list_payload_valid || !http_payload_valid || http_frames != std::vector<std::string>{"request.open", "request.chunk", "request.close"} || !stream_payload_valid || stream_frames != std::vector<std::string>{"request.open", "stream.chunk", "stream.close"} || !file_payload_valid || file_frames != std::vector<std::string>{"request.open", "stream.chunk", "stream.close"} || !cancellable_stream_payload_valid || !cancellable_started || !cancellable_chunk_valid || cancellable_frames != std::vector<std::string>{"request.open", "stream.chunk", "stream.chunk", "stream.close"} || cancellable_health_response_count != 1 || !cancellable_health_valid || !client_result) {
    std::cerr << "plain control client reconnect smoke failed: " << client_error
              << " completed=" << completed
              << " requests_valid=" << requests_valid
              << " connections=" << validated_connections
              << " registrations=" << registration_count
              << " sync_context=" << sync_context_count
              << " sync_checked=" << sync_result_checked
              << " sync_results=" << sync_result_count
              << " health=" << health_response_count
              << " stale=" << stale_response_count
              << " list=" << list_payload_valid << '/' << list_response_count
              << " http=" << http_payload_valid << '/' << http_frames.size()
              << " stream=" << stream_payload_valid << '/' << stream_frames.size()
              << " file=" << file_payload_valid << '/' << file_frames.size()
              << " cancellable=" << cancellable_stream_payload_valid << '/' << cancellable_frames.size()
              << " cancel_frames=" << cancellable_started << '/' << cancellable_chunk_valid
              << " cancel_health=" << cancellable_health_valid << '/' << cancellable_health_response_count
              << " client=" << client_result << '\n';
    return 1;
  }
  std::cout << "plain control client reconnect smoke test passed\n";
  return 0;
}
