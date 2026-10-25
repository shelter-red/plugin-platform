#include "plugmesh/control_client.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/tunnel_protocol.h"
#include "plugmesh/tls_support.h"

#include <chrono>
#include <iostream>

#include <asio/connect.hpp>
#include <asio/write.hpp>

#include <websocketpp/base64/base64.hpp>

namespace plugmesh {

namespace {

std::string text(const Json& payload, const char* key) {
  return payload.contains(key) && payload.at(key).is_string() ? payload.at(key).get<std::string>() : std::string();
}

std::string plugin_id(const ControlFrame& frame) {
  return !frame.plugin_id.empty() ? frame.plugin_id : text(frame.payload, "pluginId");
}

Json manifest(const PluginInfo& plugin) {
  return {
      {"id", plugin.id},
      {"name", plugin.name},
      {"version", plugin.version},
      {"abiVersion", plugin.abi_version},
      {"library", plugin.library.filename().string()},
      {"capabilities", {{"http", plugin.http}, {"websocket", plugin.websocket}, {"sse", plugin.sse}, {"fileStream", plugin.file_stream}}},
      {"permissions", plugin.permissions},
      {"healthPath", plugin.health_path},
      {"state", plugin_state_name(plugin.state)},
      {"lastError", plugin.last_error},
  };
}

Json manifest_list(const PluginManager& plugins) {
  Json manifests = Json::array();
  for (const auto& plugin : plugins.snapshot()) manifests.push_back(manifest(plugin));
  return manifests;
}

}  // namespace

ControlClient::ControlClient(ServerConfig config, PluginManager& plugins, std::function<void(int, const std::string&)> logger) : config_(std::move(config)), plugins_(plugins), logger_(std::move(logger)), secure_(config_.worker_url.rfind("https://", 0) == 0) {
  std::string trust_error;
  if (!tunnel_trust_store_.load(config_.tunnel_trust_file, config_.local_ui_password_verifier, trust_error) && logger_) logger_(2, trust_error);
  plugins_.set_stream_opener([this](const char* stream_id, uint16_t status, const char* headers_json) { return open_stream(stream_id, status, headers_json); });
  plugins_.set_stream_writer([this](const char* stream_id, const uint8_t* data, uint64_t size, int finished) { return write_stream(stream_id, data, size, finished); });
  const auto configure = [this](auto& client) {
    client.clear_access_channels(websocketpp::log::alevel::all);
    client.clear_error_channels(websocketpp::log::elevel::all);
    client.init_asio();
    client.set_open_handler([this](websocketpp::connection_hdl handle) { on_open(handle); });
    client.set_message_handler([this](websocketpp::connection_hdl handle, const auto& message) { on_message(handle, message->get_payload(), message->get_opcode() == websocketpp::frame::opcode::text); });
    client.set_close_handler([this](websocketpp::connection_hdl handle) { on_close(handle); });
    client.set_fail_handler([this](websocketpp::connection_hdl handle) { on_fail(handle); });
  };
  if (secure_) configure(tls_client_);
  else configure(plain_client_);
  if (!secure_) return;
  tls_hostname_ = websocketpp::uri(endpoint()).get_host();
  tls_client_.set_tls_init_handler(&ControlClient::tls_init);
  tls_client_.set_socket_init_handler([this](websocketpp::connection_hdl, asio::ssl::stream<asio::ip::tcp::socket>& socket) { configure_tls_socket(socket, tls_hostname_); });
}

ControlClient::~ControlClient() {
  stop();
  plugins_.set_stream_opener({});
  plugins_.set_stream_writer({});
}

void ControlClient::set_server_info_provider(std::function<Json()> provider) {
  server_info_provider_ = std::move(provider);
}

bool ControlClient::run(std::string& error) {
  const auto run_client = [this, &error](auto& client) {
    websocketpp::lib::error_code code;
    const auto connection = client.get_connection(endpoint(), code);
    if (code) {
      error = code.message();
      return false;
    }
    connection->append_header("Authorization", "Bearer " + config_.access_token);
    client.connect(connection);
    client.run();
    return true;
  };
  if (!(secure_ ? run_client(tls_client_) : run_client(plain_client_))) return false;
  if (!stopping_) error = "control connection stopped unexpectedly";
  return stopping_;
}

void ControlClient::stop() {
  if (stopping_.exchange(true)) return;
  std::vector<std::shared_ptr<SseWorker>> workers;
  {
    std::lock_guard lock(sse_workers_mutex_);
    workers.reserve(sse_workers_.size());
    for (const auto& [stream_id, worker] : sse_workers_) {
      (void)stream_id;
      worker->cancel_requested.store(true, std::memory_order_release);
      try {
        worker->gate->set_value();
      } catch (const std::future_error&) {
        // The request thread already passed the start gate.
      }
      workers.push_back(worker);
    }
  }
  const auto cancel_deadline = std::chrono::steady_clock::now() + std::chrono::seconds(2);
  bool pending = !workers.empty();
  while (pending && std::chrono::steady_clock::now() < cancel_deadline) {
    pending = false;
    for (const auto& worker : workers) {
      if (worker->done.load(std::memory_order_acquire)) continue;
      pending = true;
      std::string ignored;
      plugins_.cancel_sse(worker->plugin_id, worker->stream_id, "Control client stopped", ignored);
    }
    if (pending) std::this_thread::sleep_for(std::chrono::milliseconds(2));
  }
  {
    std::lock_guard lock(sse_workers_mutex_);
    for (auto& [stream_id, worker] : sse_workers_) {
      (void)stream_id;
      if (worker->thread.joinable()) worker->thread.join();
    }
    sse_workers_.clear();
  }
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  service.post([this] {
    if (heartbeat_timer_) heartbeat_timer_->cancel();
    if (reconnect_timer_) reconnect_timer_->cancel();
    if (opened_) {
      websocketpp::lib::error_code code;
      if (secure_) tls_client_.close(connection_, websocketpp::close::status::going_away, "client stopped", code);
      else plain_client_.close(connection_, websocketpp::close::status::going_away, "client stopped", code);
      opened_ = false;
    }
    std::vector<std::string> tunnel_ids;
    tunnel_ids.reserve(tunnels_.size());
    for (const auto& [session_id, tunnel] : tunnels_) {
      (void)tunnel;
      tunnel_ids.push_back(session_id);
    }
    for (const auto& session_id : tunnel_ids) close_tunnel(session_id, 1001, "Plugin server stopped");
    if (secure_) tls_client_.stop();
    else plain_client_.stop();
  });
}

bool ControlClient::rotate_access_token(std::string& access_token, std::string& error) {
  return request_binding_action("server.rotate", access_token, error);
}

bool ControlClient::revoke_binding(std::string& error) {
  std::string unused;
  return request_binding_action("server.revoke", unused, error);
}

ControlClient::TlsContext ControlClient::tls_init(websocketpp::connection_hdl) {
  return make_tls_context();
}

void ControlClient::connect() {
  if (stopping_) return;
  const auto connect_client = [this](auto& client) {
    websocketpp::lib::error_code code;
    const auto connection = client.get_connection(endpoint(), code);
    if (code) return false;
    connection->append_header("Authorization", "Bearer " + config_.access_token);
    client.connect(connection);
    return true;
  };
  if (!(secure_ ? connect_client(tls_client_) : connect_client(plain_client_))) {
    schedule_reconnect();
    return;
  }
}

void ControlClient::schedule_reconnect() {
  if (stopping_ || reconnect_timer_) return;
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  reconnect_timer_ = std::make_shared<websocketpp::lib::asio::steady_timer>(service);
  reconnect_timer_->expires_after(std::chrono::seconds(5));
  reconnect_timer_->async_wait([this](const websocketpp::lib::error_code& code) {
    reconnect_timer_.reset();
    if (!code) connect();
  });
}

void ControlClient::schedule_heartbeat() {
  if (stopping_ || !opened_) return;
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  heartbeat_timer_ = std::make_shared<websocketpp::lib::asio::steady_timer>(service);
  heartbeat_timer_->expires_after(std::chrono::seconds(15));
  heartbeat_timer_->async_wait([this](const websocketpp::lib::error_code& code) {
    heartbeat_timer_.reset();
    if (code || stopping_ || !opened_) return;
    send_frame(make_control_frame("server.heartbeat", config_.server_id));
    schedule_heartbeat();
  });
}

void ControlClient::on_open(websocketpp::connection_hdl handle) {
  for (auto& [session_id, tunnel] : tunnels_) {
    (void)session_id;
    if (!tunnel.handle.owner_before(handle) && !handle.owner_before(tunnel.handle)) {
      tunnel.websocket_open = true;
      if (tunnel_trust_store_.trusts(tunnel.source_server_id)) {
        tunnel.authenticated = true;
        websocketpp::lib::error_code send_error;
        const auto message = tunnel::frame(tunnel::kReady);
        const auto send_ready = [this, &tunnel, &message, &send_error](auto& client) { client.send(tunnel.handle, message, websocketpp::frame::opcode::binary, send_error); };
        if (secure_) send_ready(tls_client_);
        else send_ready(plain_client_);
        if (!send_error) start_tunnel_connect(session_id);
        else close_tunnel(session_id, 1011, "Tunnel authorization response failed");
      } else {
        Json challenge;
        std::string challenge_error;
        if (!make_local_ui_password_challenge(config_.local_ui_password_verifier, challenge, challenge_error)) {
          close_tunnel(session_id, 1011, "Target server could not create authorization challenge");
          return;
        }
        tunnel.auth_challenge = challenge.dump();
        websocketpp::lib::error_code send_error;
        const auto message = tunnel::frame(tunnel::kPasswordRequired, tunnel.auth_challenge);
        const auto send_challenge = [this, &tunnel, &message, &send_error](auto& client) { client.send(tunnel.handle, message, websocketpp::frame::opcode::binary, send_error); };
        if (secure_) send_challenge(tls_client_);
        else send_challenge(plain_client_);
        if (send_error) close_tunnel(session_id, 1011, "Tunnel authorization challenge failed");
      }
      return;
    }
  }
  connection_ = handle;
  opened_ = true;
  if (logger_) logger_(1, "Worker WebSocket connected");
  if (reconnect_timer_) reconnect_timer_->cancel();
}

void ControlClient::on_message(websocketpp::connection_hdl handle, const std::string& payload, bool is_text) {
  for (const auto& [session_id, tunnel] : tunnels_) {
    (void)session_id;
    if (!tunnel.handle.owner_before(handle) && !handle.owner_before(tunnel.handle)) {
      handle_tunnel_message(handle, payload, is_text);
      return;
    }
  }
  if (!is_text) return;
  ControlFrame frame;
  std::string error;
  if (!parse_control_frame(payload, frame, error) || frame.server_id != config_.server_id || !replay_guard_.accept(frame)) {
    if (logger_) logger_(2, "Worker frame rejected (invalid, mismatched, or replayed)");
    return;
  }
  if (logger_) logger_(1, "Worker frame received: " + frame.type);
  handle_frame(frame);
}

void ControlClient::on_close(websocketpp::connection_hdl handle) {
  for (auto iterator = tunnels_.begin(); iterator != tunnels_.end(); ++iterator) {
    if (!iterator->second.handle.owner_before(handle) && !handle.owner_before(iterator->second.handle)) {
      close_tunnel(iterator->first, 1000, "Tunnel peer closed");
      return;
    }
  }
  opened_ = false;
  if (logger_) logger_(2, "Worker WebSocket closed");
  if (heartbeat_timer_) heartbeat_timer_->cancel();
  schedule_reconnect();
}

void ControlClient::on_fail(websocketpp::connection_hdl handle) {
  for (auto iterator = tunnels_.begin(); iterator != tunnels_.end(); ++iterator) {
    if (!iterator->second.handle.owner_before(handle) && !handle.owner_before(iterator->second.handle)) {
      close_tunnel(iterator->first, 1011, "Tunnel connection failed");
      return;
    }
  }
  opened_ = false;
  if (logger_) logger_(3, "Worker WebSocket connection failed");
  if (heartbeat_timer_) heartbeat_timer_->cancel();
  schedule_reconnect();
}


void ControlClient::handle_frame(const ControlFrame& frame) {
  if (frame.type == "hello") {
    send_registration();
    schedule_heartbeat();
    return;
  }
  if (frame.type == "server.sync") {
    send_registration(frame.request_id);
    return;
  }
  if (frame.type == "server.result" || frame.type == "error") {
    std::lock_guard lock(binding_action_mutex_);
    const auto iterator = binding_actions_.find(frame.request_id);
    if (iterator == binding_actions_.end()) return;
    if (frame.type == "server.result") {
      iterator->second.ok = frame.payload.value("ok", false);
      iterator->second.action = text(frame.payload, "action");
      iterator->second.access_token = text(frame.payload, "accessToken");
      if (!iterator->second.ok) iterator->second.error = text(frame.payload, "error");
    } else {
      iterator->second.ok = false;
      iterator->second.error = text(frame.payload, "message");
    }
    binding_action_cv_.notify_all();
    return;
  }
  if (frame.type == "tunnel.open") {
    handle_tunnel_open(frame);
    return;
  }
  if (frame.type.rfind("plugin.", 0) == 0) {
    handle_plugin_command(frame);
    return;
  }
  if (frame.type == "request.open") {
    handle_http_request(frame);
    return;
  }
  if (frame.type == "stream.open" && frame.payload.contains("streamId")) {
    handle_sse_request(frame);
    return;
  }
  if (frame.type == "stream.open" && frame.payload.contains("connectionId")) {
    handle_websocket_open(frame);
    return;
  }
  if (frame.type == "stream.chunk") {
    handle_websocket_chunk(frame);
    return;
  }
  if (frame.type == "stream.close") {
    if (frame.payload.contains("connectionId")) handle_websocket_close(frame);
    else if (frame.payload.contains("streamId")) handle_sse_cancel(frame);
  }
}

void ControlClient::handle_plugin_command(const ControlFrame& frame) {
  const auto id = plugin_id(frame);
  const auto action = frame.type.substr(std::string("plugin.").size());
  std::string error;
  bool ok = false;
  if (action == "list") {
    Json payload = {{"action", action}, {"ok", true}, {"manifests", manifest_list(plugins_)}};
    auto response = make_control_frame("plugin.result", config_.server_id, std::move(payload));
    response.request_id = frame.request_id;
    send_frame(std::move(response));
    return;
  }
  if (action == "info") {
    Json payload = {{"action", action}, {"ok", true}, {"manifests", manifest_list(plugins_)}, {"portMappings", server_info_provider_ ? server_info_provider_().value("portMappings", Json::array()) : Json::array()}};
    auto response = make_control_frame("plugin.result", config_.server_id, std::move(payload));
    response.request_id = frame.request_id;
    send_frame(std::move(response));
    return;
  }
  if (action == "load") ok = plugins_.load(id, error);
  else if (action == "unload") ok = plugins_.unload(id, error);
  else if (action == "enable") ok = plugins_.enable(id, error);
  else if (action == "disable") ok = plugins_.disable(id, error);
  else if (action == "reload") ok = plugins_.reload(id, error);
  else if (action == "health") ok = true;
  else return;
  if (action == "health") {
    plugmesh_http_response health{};
    ok = plugins_.health(id, health, error);
    Json payload = {{"action", action}, {"ok", ok}, {"status", health.status}, {"bodySize", health.body.size}};
    if (!ok) payload["error"] = error;
    auto response = make_control_frame("plugin.result", config_.server_id, std::move(payload), id);
    response.request_id = frame.request_id;
    send_frame(std::move(response));
    return;
  }
  Json payload = {{"action", action}, {"ok", ok}};
  if (const auto info = plugins_.info_snapshot(id)) payload["state"] = plugin_state_name(info->state);
  if (!ok) payload["error"] = error;
  auto response = make_control_frame("plugin.result", config_.server_id, std::move(payload), id);
  response.request_id = frame.request_id;
  send_frame(std::move(response));
}

void ControlClient::handle_http_request(const ControlFrame& frame) {
  constexpr uint64_t kMaxHttpResponseSize = 16 * 1024 * 1024;
  constexpr uint64_t kResponseChunkSize = 8 * 1024;
  const auto id = plugin_id(frame);
  const auto method = text(frame.payload, "method");
  const auto path = text(frame.payload, "path");
  const auto headers = frame.payload.value("headers", Json::object()).dump();
  const auto encoded_body = text(frame.payload, "body");
  const auto body = text(frame.payload, "bodyEncoding") == "base64" ? websocketpp::base64_decode(encoded_body) : encoded_body;
  plugmesh_http_request request{method.c_str(), path.c_str(), headers.c_str(), reinterpret_cast<const uint8_t*>(body.data()), body.size()};
  plugmesh_http_response response{};
  std::string error;
  const auto mode = text(frame.payload, "mode");
  if (mode == "file") {
    if (!plugins_.file_stream(id, frame.request_id, request, error)) send_request_error(frame, error);
    return;
  }
  if (!plugins_.http(id, request, response, error)) {
    send_request_error(frame, error);
    return;
  }
  if (response.body.size > kMaxHttpResponseSize) {
    send_request_error(frame, "plugin HTTP response is too large");
    return;
  }
  if (response.status < 200 || response.status > 599) {
    send_request_error(frame, "plugin HTTP response status is invalid");
    return;
  }
  Json response_headers = Json::object();
  if (response.headers_json) {
    const auto parsed = Json::parse(response.headers_json, nullptr, false);
    if (parsed.is_object()) response_headers = parsed;
  }
  auto opened = make_control_frame("request.open", config_.server_id, {{"status", response.status}, {"headers", response_headers}}, id);
  opened.request_id = frame.request_id;
  send_frame(std::move(opened));
  for (uint64_t offset = 0; response.body.data && offset < response.body.size; offset += kResponseChunkSize) {
    const auto length = std::min<uint64_t>(kResponseChunkSize, response.body.size - offset);
    const auto encoded = websocketpp::base64_encode(response.body.data + offset, static_cast<size_t>(length));
    auto chunk = make_control_frame("request.chunk", config_.server_id, {{"data", encoded}, {"encoding", "base64"}}, id);
    chunk.request_id = frame.request_id;
    send_frame(std::move(chunk));
  }
  auto closed = make_control_frame("request.close", config_.server_id, {{"status", response.status}}, id);
  closed.request_id = frame.request_id;
  send_frame(std::move(closed));
}

void ControlClient::handle_sse_request(const ControlFrame& frame) {
  reap_completed_sse_workers();
  const auto id = plugin_id(frame);
  const auto stream_id = text(frame.payload, "streamId");
  if (stream_id.empty()) {
    send_request_error(frame, "invalid SSE stream");
    return;
  }
  {
    std::lock_guard lock(sse_workers_mutex_);
    if (stopping_ || sse_workers_.find(stream_id) != sse_workers_.end()) {
      send_request_error(frame, stopping_ ? "control client is stopping" : "SSE stream is already active: " + stream_id);
      return;
    }
  }

  const auto method = text(frame.payload, "method");
  const auto path = text(frame.payload, "path");
  const auto headers = frame.payload.value("headers", Json::object()).dump();
  const auto encoded_body = text(frame.payload, "body");
  const auto body = text(frame.payload, "bodyEncoding") == "base64" ? websocketpp::base64_decode(encoded_body) : encoded_body;
  auto worker = std::make_shared<SseWorker>();
  worker->plugin_id = id;
  worker->stream_id = stream_id;
  auto gate = worker->gate->get_future().share();
  worker->thread = std::thread([this, worker, gate, id, stream_id, method = std::move(method), path = std::move(path), headers = std::move(headers), body = std::move(body), request = frame]() mutable {
    gate.wait();
    if (worker->cancel_requested.load(std::memory_order_acquire) || stopping_) {
      worker->done.store(true, std::memory_order_release);
      if (!stopping_) {
        // request.open 已经发出去了，即使插件还没启动也必须给对端一个终结帧，
        // 否则这条流在客户端会一直挂起。
        auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
        service.post([this, request = std::move(request)]() mutable {
          if (stopping_) return;
          const auto stream_id = text(request.payload, "streamId");
          auto closed = make_control_frame("stream.close", config_.server_id, {{"connectionId", stream_id}, {"streamId", stream_id}, {"reason", "Client closed the stream before the plugin started"}}, plugin_id(request));
          closed.request_id = request.request_id;
          send_frame(std::move(closed));
        });
      }
      return;
    }
    plugmesh_http_request plugin_request{method.c_str(), path.c_str(), headers.c_str(), reinterpret_cast<const uint8_t*>(body.data()), body.size()};
    std::string error;
    worker->started.store(true, std::memory_order_release);
    const bool ok = plugins_.sse(id, stream_id, plugin_request, error);
    worker->done.store(true, std::memory_order_release);
    if (!ok && !worker->cancel_requested.load(std::memory_order_acquire) && !stopping_) {
      auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
      service.post([this, request = std::move(request), error = std::move(error)]() mutable {
        if (!stopping_) send_sse_error(request, error.empty() ? "plugin SSE request failed" : error);
      });
    }
  });
  bool registered = false;
  {
    std::lock_guard lock(sse_workers_mutex_);
    if (stopping_ || sse_workers_.find(stream_id) != sse_workers_.end()) {
      worker->cancel_requested.store(true, std::memory_order_release);
    } else {
      sse_workers_.emplace(stream_id, worker);
      registered = true;
    }
  }
  if (!registered) {
    try {
      worker->gate->set_value();
    } catch (const std::future_error&) {
      // stop() may release the gate while this handler is finishing.
    }
    if (worker->thread.joinable()) worker->thread.join();
    return;
  }
  auto opened = make_control_frame("request.open", config_.server_id, {{"status", 200}, {"headers", {{"content-type", "text/event-stream; charset=utf-8"}, {"cache-control", "no-cache"}}}}, id);
  opened.request_id = frame.request_id;
  send_frame(std::move(opened));
  try {
    worker->gate->set_value();
  } catch (const std::future_error&) {
    // stop() may release the gate while this handler is finishing.
  }
}

void ControlClient::handle_sse_cancel(const ControlFrame& frame) {
  const auto id = plugin_id(frame);
  const auto stream_id = text(frame.payload, "streamId");
  const auto reason = text(frame.payload, "reason");
  if (stream_id.empty()) {
    send_error(frame, "SSE stream id is empty");
    return;
  }
  bool started = false;
  {
    std::lock_guard lock(sse_workers_mutex_);
    const auto iterator = sse_workers_.find(stream_id);
    if (iterator == sse_workers_.end()) {
      send_error(frame, "SSE stream is not active: " + stream_id);
      return;
    }
    iterator->second->cancel_requested.store(true, std::memory_order_release);
    started = iterator->second->started.load(std::memory_order_acquire);
  }
  // 插件还没开始执行时没有必要转发取消：worker 已经在 request.open 之后
  // 补发了 stream.close，转发只会得到一个“流不存在”的错误。
  if (!started) return;
  std::string error;
  if (!plugins_.cancel_sse(id, stream_id, reason, error)) send_error(frame, error.empty() ? "SSE cancellation failed" : error);
}

void ControlClient::send_sse_error(const ControlFrame& request, const std::string& message) {
  const auto id = plugin_id(request);
  auto chunk = make_control_frame("stream.chunk", config_.server_id, {{"data", Json{{"error", message}}.dump()}, {"encoding", "text"}}, id);
  chunk.request_id = request.request_id;
  send_frame(std::move(chunk));
  auto closed = make_control_frame("stream.close", config_.server_id, {{"status", 502}, {"reason", "Plugin SSE request failed"}}, id);
  closed.request_id = request.request_id;
  send_frame(std::move(closed));
}

void ControlClient::reap_completed_sse_workers() {
  std::vector<std::thread> completed;
  {
    std::lock_guard lock(sse_workers_mutex_);
    for (auto iterator = sse_workers_.begin(); iterator != sse_workers_.end();) {
      if (!iterator->second->done.load(std::memory_order_acquire)) {
        ++iterator;
        continue;
      }
      completed.push_back(std::move(iterator->second->thread));
      iterator = sse_workers_.erase(iterator);
    }
  }
  for (auto& thread : completed) {
    if (thread.joinable()) thread.join();
  }
}

void ControlClient::handle_websocket_open(const ControlFrame& frame) {
  const auto id = plugin_id(frame);
  const auto connection_id = text(frame.payload, "connectionId");
  const auto path = text(frame.payload, "path");
  const auto headers = frame.payload.value("headers", Json::object()).dump();
  std::string error;
  if (connection_id.empty() || !plugins_.websocket_open(id, connection_id, path, headers, error)) send_error(frame, error.empty() ? "invalid WebSocket open request" : error);
}

void ControlClient::handle_websocket_chunk(const ControlFrame& frame) {
  const auto id = plugin_id(frame);
  const auto connection_id = text(frame.payload, "connectionId");
  const auto data = text(frame.payload, "data");
  const auto encoding = text(frame.payload, "encoding");
  const auto decoded = encoding == "base64" ? websocketpp::base64_decode(data) : data;
  std::string error;
  if (!plugins_.websocket(id, connection_id, reinterpret_cast<const uint8_t*>(decoded.data()), decoded.size(), encoding != "base64", error)) send_error(frame, error);
}

void ControlClient::handle_websocket_close(const ControlFrame& frame) {
  const auto id = plugin_id(frame);
  const auto connection_id = text(frame.payload, "connectionId");
  uint16_t code = 1000;
  const auto code_iterator = frame.payload.find("code");
  if (code_iterator != frame.payload.end() && (code_iterator->is_number_integer() || code_iterator->is_number_unsigned())) {
    if (code_iterator->is_number_unsigned()) {
      const auto numeric_code = code_iterator->get<uint64_t>();
      if (numeric_code >= 1000 && numeric_code <= 4999) code = static_cast<uint16_t>(numeric_code);
    } else {
      const auto numeric_code = code_iterator->get<int64_t>();
      if (numeric_code >= 1000 && numeric_code <= 4999) code = static_cast<uint16_t>(numeric_code);
    }
  }
  const auto reason = text(frame.payload, "reason");
  std::string error;
  if (connection_id.empty() || !plugins_.websocket_close(id, connection_id, code, reason, error)) send_error(frame, error.empty() ? "invalid WebSocket close request" : error);
}

void ControlClient::handle_tunnel_open(const ControlFrame& frame) {
  const auto session_id = text(frame.payload, "sessionId");
  const auto host = text(frame.payload, "targetHost");
  const auto source_server_id = text(frame.payload, "sourceServerId");
  const auto port_value = frame.payload.value("targetPort", 0);
  if (session_id.empty() || source_server_id.empty() || host.empty() || host.size() > 253 || port_value < 1 || port_value > 65535) {
    if (logger_) logger_(2, "Worker tunnel request rejected (invalid target)");
    return;
  }
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  TunnelConnection tunnel;
  tunnel.socket = std::make_shared<asio::ip::tcp::socket>(service);
  tunnel.resolver = std::make_shared<asio::ip::tcp::resolver>(service);
  tunnel.source_server_id = source_server_id;
  tunnel.target_host = host;
  tunnel.target_port = static_cast<uint16_t>(port_value);
  websocketpp::lib::error_code error;
  auto tunnel_url = endpoint();
  const auto route = tunnel_url.find("/control/connect?");
  if (route == std::string::npos) return;
  tunnel_url.replace(route, std::string("/control/connect?").size(), "/control/tunnel/target?");
  tunnel_url += "&sessionId=" + session_id;
  if (tunnels_.contains(session_id)) close_tunnel(session_id, 1012, "Tunnel replaced");
  tunnels_.emplace(session_id, std::move(tunnel));

  const auto connect_tunnel = [this, &tunnel_url, &session_id](auto& client) {
    websocketpp::lib::error_code connection_error;
    const auto connection = client.get_connection(tunnel_url, connection_error);
    if (connection_error) return false;
    connection->append_header("Authorization", "Bearer " + config_.access_token);
    tunnels_.at(session_id).handle = connection->get_handle();
    client.connect(connection);
    return true;
  };
  if (!(secure_ ? connect_tunnel(tls_client_) : connect_tunnel(plain_client_))) {
    close_tunnel(session_id, 1011, "Worker tunnel connection could not be created");
    return;
  }

  if (logger_) logger_(1, "Worker TCP tunnel opened: " + session_id);
}

void ControlClient::start_tunnel_connect(const std::string& session_id) {
  const auto found = tunnels_.find(session_id);
  if (found == tunnels_.end() || !found->second.authenticated || !found->second.websocket_open || found->second.tcp_connected) return;
  const auto host = found->second.target_host;
  const auto port = std::to_string(found->second.target_port);
  found->second.resolver->async_resolve(host, port, [this, session_id](const asio::error_code& resolve_error, asio::ip::tcp::resolver::results_type endpoints) {
    const auto current = tunnels_.find(session_id);
    if (current == tunnels_.end()) return;
    if (resolve_error) {
      close_tunnel(session_id, 1011, "Target address could not be resolved");
      return;
    }
    asio::async_connect(*current->second.socket, endpoints, [this, session_id](const asio::error_code& connect_error, const asio::ip::tcp::endpoint&) {
      const auto connected = tunnels_.find(session_id);
      if (connected == tunnels_.end()) return;
      if (connect_error) {
        close_tunnel(session_id, 1011, "Target TCP service is unavailable");
        return;
      }
      connected->second.tcp_connected = true;
      pump_tunnel_write(session_id);
      start_tunnel_read(session_id);
    });
  });
}

void ControlClient::start_tunnel_read(const std::string& session_id) {
  const auto found = tunnels_.find(session_id);
  if (found == tunnels_.end() || !found->second.tcp_connected || !found->second.websocket_open) return;
  found->second.socket->async_read_some(asio::buffer(found->second.read_buffer), [this, session_id](const asio::error_code& error, std::size_t size) {
    handle_tunnel_tcp_read(session_id, error, size);
  });
}

void ControlClient::handle_tunnel_tcp_read(const std::string& session_id, const asio::error_code& error, std::size_t size) {
  const auto found = tunnels_.find(session_id);
  if (found == tunnels_.end()) return;
  if (error || size == 0) {
    if (error == asio::error::eof) {
      found->second.local_fin_sent = true;
      websocketpp::lib::error_code fin_error;
      const auto message = tunnel::frame(tunnel::kFin);
      const auto send_fin = [&found, &message, &fin_error](auto& client) {
        client.send(found->second.handle, message, websocketpp::frame::opcode::binary, fin_error);
      };
      if (secure_) send_fin(tls_client_);
      else send_fin(plain_client_);
      if (fin_error || found->second.peer_fin_received) close_tunnel(session_id, fin_error ? 1011 : 1000, "TCP tunnel finished");
      return;
    }
    close_tunnel(session_id, 1011, "Target TCP service closed");
    return;
  }
  websocketpp::lib::error_code send_error;
  const auto payload = std::string(reinterpret_cast<const char*>(found->second.read_buffer.data()), size);
  const auto message = tunnel::frame(tunnel::kData, payload);
  const auto send_tunnel_data = [&found, &message, &send_error](auto& client) {
    client.send(found->second.handle, message, websocketpp::frame::opcode::binary, send_error);
  };
  if (secure_) send_tunnel_data(tls_client_);
  else send_tunnel_data(plain_client_);
  if (send_error) {
    close_tunnel(session_id, 1011, "Tunnel send failed");
    return;
  }
  start_tunnel_read(session_id);
}

void ControlClient::handle_tunnel_message(websocketpp::connection_hdl handle, const std::string& payload, bool is_text) {
  for (auto& [session_id, tunnel] : tunnels_) {
    if (tunnel.handle.owner_before(handle) || handle.owner_before(tunnel.handle)) continue;
    uint8_t type = 0;
    std::string data;
    if (is_text || !tunnel::parse(payload, type, data)) {
      close_tunnel(session_id, 1003, "Invalid tunnel frame");
      return;
    }
    if (!tunnel.authenticated) {
      bool proof_valid = false;
      try {
        const auto challenge = Json::parse(tunnel.auth_challenge);
        const auto context = tunnel.source_server_id + "\n" + config_.server_id + "\n" + session_id;
        proof_valid = type == tunnel::kAuthenticate && verify_local_ui_password_proof(config_.local_ui_password_verifier, challenge, context, data);
      } catch (...) {}
      if (!proof_valid) {
        websocketpp::lib::error_code auth_error;
        const auto response = tunnel::frame(tunnel::kAuthResult, std::string(1, '\0'));
        const auto send_result = [&tunnel, &response, &auth_error](auto& client) { client.send(tunnel.handle, response, websocketpp::frame::opcode::binary, auth_error); };
        if (secure_) send_result(tls_client_);
        else send_result(plain_client_);
        close_tunnel(session_id, 1008, "Target server authorization failed");
        return;
      }
      std::string trust_error;
      if (!tunnel_trust_store_.trust(tunnel.source_server_id, trust_error)) {
        close_tunnel(session_id, 1011, "Target server could not persist authorization");
        return;
      }
      tunnel.authenticated = true;
      websocketpp::lib::error_code auth_error;
      const auto response = tunnel::frame(tunnel::kAuthResult, std::string(1, '\1'));
      const auto send_result = [&tunnel, &response, &auth_error](auto& client) { client.send(tunnel.handle, response, websocketpp::frame::opcode::binary, auth_error); };
      if (secure_) send_result(tls_client_);
      else send_result(plain_client_);
      if (auth_error) close_tunnel(session_id, 1011, "Target server authorization response failed");
      else start_tunnel_connect(session_id);
      return;
    }
    if (type == tunnel::kFin) {
      asio::error_code ignored;
      tunnel.socket->shutdown(asio::ip::tcp::socket::shutdown_send, ignored);
      tunnel.peer_fin_received = true;
      if (tunnel.local_fin_sent) close_tunnel(session_id, 1000, "TCP tunnel finished");
      return;
    }
    if (type != tunnel::kData) {
      close_tunnel(session_id, 1003, "Invalid tunnel data frame");
      return;
    }
    data.assign(data.data(), data.size());
    constexpr std::size_t max_queued_tunnel_bytes = 256 * 1024;
    if (data.size() > max_queued_tunnel_bytes - tunnel.write_bytes) {
      close_tunnel(session_id, 1009, "Tunnel write queue is full");
      return;
    }
    tunnel.write_bytes += data.size();
    tunnel.writes.push_back(std::move(data));
    if (!tunnel.writing) pump_tunnel_write(session_id);
    return;
  }
}

void ControlClient::pump_tunnel_write(const std::string& session_id) {
  const auto found = tunnels_.find(session_id);
  if (found == tunnels_.end() || !found->second.tcp_connected || found->second.writes.empty() || found->second.writing) return;
  found->second.writing = true;
  auto buffer = std::make_shared<std::string>(found->second.writes.front());
  asio::async_write(*found->second.socket, asio::buffer(*buffer), [this, session_id, buffer](const asio::error_code& error, std::size_t) {
    const auto current = tunnels_.find(session_id);
    if (current == tunnels_.end()) return;
    current->second.writing = false;
    if (error) {
      close_tunnel(session_id, 1011, "Target TCP write failed");
      return;
    }
    current->second.write_bytes -= current->second.writes.front().size();
    current->second.writes.pop_front();
    pump_tunnel_write(session_id);
  });
}

void ControlClient::close_tunnel(const std::string& session_id, uint16_t code, const std::string& reason) {
  const auto found = tunnels_.find(session_id);
  if (found == tunnels_.end()) return;
  auto handle = found->second.handle;
  auto socket = found->second.socket;
  tunnels_.erase(found);
  asio::error_code ignored;
  socket->shutdown(asio::ip::tcp::socket::shutdown_both, ignored);
  socket->close(ignored);
  websocketpp::lib::error_code close_error;
  const auto close_connection = [&handle, code, &reason, &close_error](auto& client) {
    client.close(handle, static_cast<websocketpp::close::status::value>(code), reason, close_error);
  };
  if (secure_) close_connection(tls_client_);
  else close_connection(plain_client_);
}

int ControlClient::write_stream(const char* stream_id, const uint8_t* data, uint64_t size, int finished) {
  if (!stream_id || (!data && size > 0)) return -1;
  constexpr uint64_t kChunkSize = 32 * 1024;
  const auto connection_id = std::string(stream_id);
  if (size == 0 && !finished) return 0;
  for (uint64_t offset = 0; offset < size || (size == 0 && offset == 0);) {
    const auto length = std::min<uint64_t>(kChunkSize, size - offset);
    const auto encoded = length == 0 ? std::string() : websocketpp::base64_encode(data + offset, static_cast<size_t>(length));
    auto frame = make_control_frame("stream.chunk", config_.server_id, { {"connectionId", connection_id}, {"streamId", connection_id}, {"data", encoded}, {"encoding", "base64"} });
    frame.request_id = connection_id;
    auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
    service.post([this, frame = std::move(frame)]() mutable { send_frame(std::move(frame)); });
    offset += length;
    if (size == 0) break;
  }
  if (finished) {
    auto close = make_control_frame("stream.close", config_.server_id, {{"connectionId", connection_id}, {"streamId", connection_id}});
    close.request_id = connection_id;
    auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
    service.post([this, close = std::move(close)]() mutable { send_frame(std::move(close)); });
  }
  return 0;
}

int ControlClient::open_stream(const char* stream_id, uint16_t status, const char* headers_json) {
  if (!stream_id || !headers_json) return -1;
  Json headers = Json::parse(headers_json, nullptr, false);
  if (!headers.is_object()) headers = Json::object();
  auto frame = make_control_frame("request.open", config_.server_id, {{"status", status}, {"headers", headers}, {"fileStream", true}});
  frame.request_id = stream_id;
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  service.post([this, frame = std::move(frame)]() mutable { send_frame(std::move(frame)); });
  return 0;
}

void ControlClient::send_frame(ControlFrame frame) {
  if (logger_) logger_(1, "Worker frame sent: " + frame.type);
  if (!opened_ || stopping_) return;
  websocketpp::lib::error_code code;
  const auto serialized = serialize_control_frame(frame);
  if (secure_) tls_client_.send(connection_, serialized, websocketpp::frame::opcode::text, code);
  else plain_client_.send(connection_, serialized, websocketpp::frame::opcode::text, code);
}

void ControlClient::send_error(const ControlFrame& request, const std::string& message) {
  auto response = make_control_frame("error", config_.server_id, {{"message", message}}, plugin_id(request));
  response.request_id = request.request_id;
  send_frame(std::move(response));
}

void ControlClient::send_request_error(const ControlFrame& request, const std::string& message) {
  auto opened = make_control_frame("request.open", config_.server_id, {{"status", 502}, {"headers", {{"content-type", "application/json; charset=utf-8"}}}}, plugin_id(request));
  opened.request_id = request.request_id;
  send_frame(std::move(opened));
  auto chunk = make_control_frame("request.chunk", config_.server_id, {{"data", Json{{"error", message}}.dump()}, {"encoding", "text"}}, plugin_id(request));
  chunk.request_id = request.request_id;
  send_frame(std::move(chunk));
  auto closed = make_control_frame("request.close", config_.server_id, {{"status", 502}}, plugin_id(request));
  closed.request_id = request.request_id;
  send_frame(std::move(closed));
}

void ControlClient::send_registration(const std::string& sync_request_id) {
  Json payload = {{"manifests", manifest_list(plugins_)}};
  if (!sync_request_id.empty()) payload["syncRequestId"] = sync_request_id;
  send_frame(make_control_frame("server.register", config_.server_id, std::move(payload)));
}

bool ControlClient::request_binding_action(const std::string& type, std::string& access_token, std::string& error) {
  if (!opened_ || stopping_) {
    error = "control connection is offline";
    return false;
  }
  auto frame = make_control_frame(type, config_.server_id);
  const auto request_id = frame.request_id;
  {
    std::lock_guard lock(binding_action_mutex_);
    binding_actions_.emplace(request_id, BindingActionResult{});
  }
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  service.post([this, frame = std::move(frame)]() mutable {
    if (opened_ && !stopping_) send_frame(std::move(frame));
  });
  std::unique_lock lock(binding_action_mutex_);
  const auto completed = binding_action_cv_.wait_for(lock, std::chrono::seconds(15), [&] {
    const auto iterator = binding_actions_.find(request_id);
    return iterator == binding_actions_.end() || iterator->second.ok || !iterator->second.error.empty() || !opened_ || stopping_;
  });
  const auto iterator = binding_actions_.find(request_id);
  if (!completed || iterator == binding_actions_.end()) {
    binding_actions_.erase(request_id);
    error = "server binding action timed out";
    return false;
  }
  const auto result = iterator->second;
  binding_actions_.erase(iterator);
  if (!result.ok) {
    error = result.error.empty() ? "server binding action failed" : result.error;
    return false;
  }
  access_token = result.access_token;
  if (type == "server.rotate") {
    if (access_token.empty()) {
      error = "server rotation response is incomplete";
      return false;
    }
    update_access_token(access_token);
  }
  return true;
}

void ControlClient::update_access_token(std::string access_token) {
  auto& service = secure_ ? tls_client_.get_io_service() : plain_client_.get_io_service();
  service.post([this, access_token = std::move(access_token)]() mutable { config_.access_token = std::move(access_token); });
}

std::string ControlClient::endpoint() const {
  auto worker_url = config_.worker_url;
  if (worker_url.rfind("https://", 0) == 0) worker_url.replace(0, 8, "wss://");
  else if (worker_url.rfind("http://", 0) == 0) worker_url.replace(0, 7, "ws://");
  if (!worker_url.empty() && worker_url.back() == '/') worker_url.pop_back();
  return worker_url + "/control/connect?serverId=" + config_.server_id;
}

}  // namespace plugmesh
