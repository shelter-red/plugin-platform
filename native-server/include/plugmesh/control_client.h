#pragma once

#include "plugmesh/control_protocol.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/server_config.h"

#include <atomic>
#include <memory>
#include <string>

#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>

namespace plugmesh {

class ControlClient {
 public:
  using Client = websocketpp::client<websocketpp::config::asio_tls_client>;
  using Message = Client::message_ptr;

  ControlClient(ServerConfig config, PluginManager& plugins);
  ControlClient(const ControlClient&) = delete;
  ControlClient& operator=(const ControlClient&) = delete;
  ~ControlClient();

  bool run(std::string& error);
  void stop();
  bool connected() const { return opened_.load(std::memory_order_acquire); }

 private:
  using TlsContext = websocketpp::lib::shared_ptr<websocketpp::lib::asio::ssl::context>;

  static TlsContext tls_init(websocketpp::connection_hdl);
  void connect();
  void schedule_reconnect();
  void schedule_heartbeat();
  void on_open(websocketpp::connection_hdl handle);
  void on_message(websocketpp::connection_hdl handle, Message message);
  void on_close(websocketpp::connection_hdl handle);
  void on_fail(websocketpp::connection_hdl handle);
  void handle_frame(const ControlFrame& frame);
  void handle_plugin_command(const ControlFrame& frame);
  void handle_http_request(const ControlFrame& frame);
  void handle_sse_request(const ControlFrame& frame);
  void handle_websocket_chunk(const ControlFrame& frame);
  int write_stream(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
  void send_frame(ControlFrame frame);
  void send_error(const ControlFrame& request, const std::string& message);
  void send_registration();
  std::string endpoint() const;

  ServerConfig config_;
  PluginManager& plugins_;
  Client client_;
  websocketpp::connection_hdl connection_;
  std::shared_ptr<websocketpp::lib::asio::steady_timer> heartbeat_timer_;
  std::shared_ptr<websocketpp::lib::asio::steady_timer> reconnect_timer_;
  std::atomic<bool> stopping_{false};
  std::atomic<bool> opened_{false};
};

}  // namespace plugmesh
