#pragma once

#include "plugmesh/control_protocol.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/server_config.h"
#include "plugmesh/tunnel_trust_store.h"

#include <atomic>
#include <array>
#include <condition_variable>
#include <deque>
#include <future>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>

#include <asio/ip/tcp.hpp>

#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>

namespace plugmesh {

class ControlClient {
 public:
  ControlClient(ServerConfig config, PluginManager& plugins, std::function<void(int, const std::string&)> logger = {});
  ControlClient(const ControlClient&) = delete;
  ControlClient& operator=(const ControlClient&) = delete;
  ~ControlClient();

  bool run(std::string& error);
  void stop();
  bool connected() const { return opened_.load(std::memory_order_acquire); }
  bool rotate_access_token(std::string& access_token, std::string& error);
  bool revoke_binding(std::string& error);

 private:
  using TlsClient = websocketpp::client<websocketpp::config::asio_tls_client>;
  using PlainClient = websocketpp::client<websocketpp::config::asio_client>;
  using TlsContext = websocketpp::lib::shared_ptr<websocketpp::lib::asio::ssl::context>;

  static TlsContext tls_init(websocketpp::connection_hdl);
  void connect();
  void schedule_reconnect();
  void schedule_heartbeat();
  void on_open(websocketpp::connection_hdl handle);
  void on_message(websocketpp::connection_hdl handle, const std::string& payload, bool is_text);
  void on_close(websocketpp::connection_hdl handle);
  void on_fail(websocketpp::connection_hdl handle);
  void handle_frame(const ControlFrame& frame);
  void handle_plugin_command(const ControlFrame& frame);
  void handle_http_request(const ControlFrame& frame);
  void handle_sse_request(const ControlFrame& frame);
  void handle_sse_cancel(const ControlFrame& frame);
  void send_sse_error(const ControlFrame& request, const std::string& message);
  void reap_completed_sse_workers();
  void handle_websocket_open(const ControlFrame& frame);
  void handle_websocket_chunk(const ControlFrame& frame);
  void handle_websocket_close(const ControlFrame& frame);
  void handle_tunnel_open(const ControlFrame& frame);
  void handle_tunnel_message(websocketpp::connection_hdl handle, const std::string& payload, bool is_text);
  void start_tunnel_read(const std::string& session_id);
  void start_tunnel_connect(const std::string& session_id);
  void handle_tunnel_tcp_read(const std::string& session_id, const asio::error_code& error, std::size_t size);
  void pump_tunnel_write(const std::string& session_id);
  void close_tunnel(const std::string& session_id, uint16_t code, const std::string& reason);
  int write_stream(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
  int open_stream(const char* stream_id, uint16_t status, const char* headers_json);
  void send_frame(ControlFrame frame);
  void send_error(const ControlFrame& request, const std::string& message);
  void send_request_error(const ControlFrame& request, const std::string& message);
  void send_registration(const std::string& sync_request_id = {});
  bool request_binding_action(const std::string& type, std::string& access_token, std::string& error);
  void update_access_token(std::string access_token);
  std::string endpoint() const;

  struct SseWorker {
    std::thread thread;
    std::shared_ptr<std::promise<void>> gate = std::make_shared<std::promise<void>>();
    std::string plugin_id;
    std::string stream_id;
    std::atomic<bool> done{false};
    std::atomic<bool> cancel_requested{false};
    // 插件侧（handle_sse）是否已经真正开始执行。取消通知在它之前没有意义：
    // 此时还没有可取消的插件流，worker 会在 request.open 之后补一个 stream.close。
    std::atomic<bool> started{false};
  };

  struct BindingActionResult {
    bool ok = false;
    std::string action;
    std::string access_token;
    std::string error;
  };

  ServerConfig config_;
  PluginManager& plugins_;
  std::function<void(int, const std::string&)> logger_;
  bool secure_;
  std::string tls_hostname_;
  TlsClient tls_client_;
  PlainClient plain_client_;
  websocketpp::connection_hdl connection_;
  std::shared_ptr<websocketpp::lib::asio::steady_timer> heartbeat_timer_;
  std::shared_ptr<websocketpp::lib::asio::steady_timer> reconnect_timer_;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> opened_{false};
  ControlFrameReplayGuard replay_guard_;
  std::mutex binding_action_mutex_;
  std::condition_variable binding_action_cv_;
  std::map<std::string, BindingActionResult> binding_actions_;
  std::mutex sse_workers_mutex_;
  std::unordered_map<std::string, std::shared_ptr<SseWorker>> sse_workers_;
  struct TunnelConnection {
    websocketpp::connection_hdl handle;
    std::shared_ptr<asio::ip::tcp::socket> socket;
    std::array<uint8_t, 16 * 1024> read_buffer{};
    std::deque<std::string> writes;
    std::size_t write_bytes = 0;
    bool websocket_open = false;
    bool tcp_connected = false;
    bool writing = false;
    bool local_fin_sent = false;
    bool peer_fin_received = false;
    bool authenticated = false;
    std::string source_server_id;
    std::string auth_challenge;
    std::string target_host;
    uint16_t target_port = 0;
    std::shared_ptr<asio::ip::tcp::resolver> resolver;
  };
  std::mutex tunnels_mutex_;
  std::unordered_map<std::string, TunnelConnection> tunnels_;
  TunnelTrustStore tunnel_trust_store_;
};

}  // namespace plugmesh
