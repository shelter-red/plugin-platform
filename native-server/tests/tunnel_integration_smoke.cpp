#include "plugmesh/control_client.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/port_mapper.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/server_config.h"
#include "plugmesh/tunnel_protocol.h"

#include <asio.hpp>
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <array>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

namespace {

using Tcp = asio::ip::tcp;
using Worker = websocketpp::server<websocketpp::config::asio>;

std::string query_value(const std::string& resource, const std::string& key) {
  const auto marker = key + "=";
  const auto start = resource.find(marker);
  if (start == std::string::npos) return {};
  const auto value_start = start + marker.size();
  const auto end = resource.find('&', value_start);
  return resource.substr(value_start, end == std::string::npos ? std::string::npos : end - value_start);
}

class EchoServer {
 public:
  EchoServer() {
    acceptor_.open(Tcp::v4());
    acceptor_.set_option(Tcp::acceptor::reuse_address(true));
    acceptor_.bind(Tcp::endpoint(asio::ip::address_v4::loopback(), 0));
    acceptor_.listen();
    port_ = acceptor_.local_endpoint().port();
    thread_ = std::thread([this] { run(); });
  }

  ~EchoServer() {
    asio::error_code ignored;
    acceptor_.close(ignored);
    if (thread_.joinable()) thread_.join();
  }

  uint16_t port() const { return port_; }
  bool completed() const { return completed_.load(); }

 private:
  void run() {
    asio::io_context context;
    Tcp::socket socket(context);
    asio::error_code error;
    acceptor_.accept(socket, error);
    if (error) return;
    std::array<char, 12> payload{};
    asio::read(socket, asio::buffer(payload), error);
    if (error) return;
    asio::write(socket, asio::buffer(payload), error);
    completed_ = !error;
  }

  asio::io_context context_;
  Tcp::acceptor acceptor_{context_};
  uint16_t port_{};
  std::atomic<bool> completed_{false};
  std::thread thread_;
};

class MockWorker {
 public:
  MockWorker() {
    worker_.clear_access_channels(websocketpp::log::alevel::all);
    worker_.clear_error_channels(websocketpp::log::elevel::all);
    worker_.init_asio();
    worker_.set_reuse_addr(true);
    worker_.set_http_handler([this](websocketpp::connection_hdl handle) {
      const auto connection = worker_.get_con_from_hdl(handle);
      connection->set_status(websocketpp::http::status_code::ok);
      connection->set_body(R"({"results":[{"id":"target","name":"Target server","status":"online"}]})");
    });
    worker_.set_open_handler([this](websocketpp::connection_hdl handle) {
      const auto connection = worker_.get_con_from_hdl(handle);
      const auto resource = connection->get_resource();
      std::lock_guard lock(mutex_);
      if (resource.rfind("/control/connect?", 0) == 0) {
        controls_[query_value(resource, "serverId")] = handle;
        send_control_hello(handle, query_value(resource, "serverId"));
      } else if (resource.rfind("/control/tunnel/connect?", 0) == 0) {
        source_ = handle;
        session_id_ = "integration-session";
        source_resource_ = resource;
        const auto session = plugmesh::tunnel::frame(plugmesh::tunnel::kSessionId, session_id_);
        websocketpp::lib::error_code error;
        worker_.send(handle, session, websocketpp::frame::opcode::binary, error);
        send_tunnel_open(resource);
      } else if (resource.rfind("/control/tunnel/target?", 0) == 0) {
        target_ = handle;
      }
    });
    worker_.set_message_handler([this](websocketpp::connection_hdl handle, Worker::message_ptr message) {
      std::lock_guard lock(mutex_);
      if (same(handle, source_) || same(handle, target_)) {
        const auto peer = same(handle, source_) ? target_ : source_;
        if (!peer.expired()) {
          websocketpp::lib::error_code error;
          worker_.send(peer, message->get_payload(), message->get_opcode(), error);
        }
        return;
      }
      if (message->get_opcode() != websocketpp::frame::opcode::text) return;
      plugmesh::ControlFrame frame;
      std::string error;
      if (!plugmesh::parse_control_frame(message->get_payload(), frame, error)) return;
      if (frame.type == "server.register") {
        auto result = plugmesh::make_control_frame("server.registered", frame.server_id, { {"ok", true} });
        result.request_id = frame.request_id;
        send_text(handle, plugmesh::serialize_control_frame(result));
      }
    });
    worker_.set_close_handler([this](websocketpp::connection_hdl handle) {
      std::lock_guard lock(mutex_);
      if (same(handle, source_)) source_.reset();
      if (same(handle, target_)) target_.reset();
    });
    worker_.listen(Tcp::endpoint(asio::ip::address_v4::loopback(), 0));
    websocketpp::lib::error_code endpoint_error;
    port_ = worker_.get_local_endpoint(endpoint_error).port();
    if (endpoint_error) throw std::runtime_error("mock Worker failed to bind");
    worker_.start_accept();
    thread_ = std::thread([this] { worker_.run(); });
  }

  ~MockWorker() {
    worker_.stop_listening();
    worker_.stop();
    if (thread_.joinable()) thread_.join();
  }

  uint16_t port() const { return port_; }

 private:
  static bool same(const websocketpp::connection_hdl& left, const websocketpp::connection_hdl& right) {
    return !left.owner_before(right) && !right.owner_before(left);
  }

  void send_text(websocketpp::connection_hdl handle, const std::string& payload) {
    websocketpp::lib::error_code error;
    worker_.send(handle, payload, websocketpp::frame::opcode::text, error);
  }

  void send_control_hello(websocketpp::connection_hdl handle, const std::string& server_id) {
    send_text(handle, plugmesh::serialize_control_frame(plugmesh::make_control_frame("hello", server_id)));
  }

  void send_tunnel_open(const std::string& resource) {
    const auto target = controls_.find("target");
    if (target == controls_.end()) return;
    auto frame = plugmesh::make_control_frame("tunnel.open", "target", {
        {"sessionId", session_id_},
        {"sourceServerId", query_value(resource, "serverId")},
        {"targetHost", "127.0.0.1"},
        {"targetPort", std::stoi(query_value(resource, "targetPort"))},
        {"protocol", "tcp"},
    });
    send_text(target->second, plugmesh::serialize_control_frame(frame));
  }

  Worker worker_;
  uint16_t port_{};
  std::thread thread_;
  std::mutex mutex_;
  std::map<std::string, websocketpp::connection_hdl> controls_;
  websocketpp::connection_hdl source_;
  websocketpp::connection_hdl target_;
  std::string session_id_;
  std::string source_resource_;
};

uint16_t unused_port() {
  asio::io_context context;
  Tcp::acceptor acceptor(context, Tcp::endpoint(asio::ip::address_v4::loopback(), 0));
  return acceptor.local_endpoint().port();
}

bool wait_for(const std::function<bool()>& predicate, std::chrono::milliseconds timeout) {
  const auto deadline = std::chrono::steady_clock::now() + timeout;
  while (std::chrono::steady_clock::now() < deadline) {
    if (predicate()) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  return predicate();
}

}  // namespace

int main() {
  MockWorker worker;
  EchoServer echo;

  const auto directory = std::filesystem::temp_directory_path() / ("plugmesh-tunnel-integration-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  std::filesystem::create_directories(directory);
  const auto mapping_file = directory / "mappings.json";
  const auto trust_file = directory / "target-trust.json";
  {
    std::ofstream output(mapping_file);
    output << R"({"mappings":[]})";
  }

  std::string verifier;
  std::string error;
  if (!plugmesh::make_local_ui_password_verifier("target-login-secret", verifier, error)) return 1;
  plugmesh::ServerConfig target_config;
  target_config.worker_url = "http://127.0.0.1:" + std::to_string(worker.port());
  target_config.server_id = "target";
  target_config.access_token = "target-token";
  target_config.local_ui_password_verifier = verifier;
  target_config.tunnel_trust_file = trust_file;
  plugmesh::PluginManager target_plugins;
  plugmesh::ControlClient target_client(target_config, target_plugins);
  std::string target_error;
  std::thread target_thread([&] { target_client.run(target_error); });
  if (!wait_for([&] { return target_client.connected(); }, std::chrono::seconds(3))) {
    target_client.stop();
    if (target_thread.joinable()) target_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }

  plugmesh::ServerConfig source_config;
  source_config.worker_url = target_config.worker_url;
  source_config.server_id = "source";
  source_config.access_token = "source-token";
  source_config.port_mappings_file = mapping_file;
  plugmesh::PortMapper mapper;
  if (!mapper.start(source_config, error)) {
    target_client.stop();
    if (target_thread.joinable()) target_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }
  const auto listener_port = unused_port();
  const auto wrong_password = mapper.handle_request("POST", "/api/mappings", {
      {"name", "integration"}, {"protocol", "tcp"}, {"listenPort", listener_port},
      {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", echo.port()},
      {"targetPassword", "wrong-password"}, {"enabled", true},
  }, error);
  if (!error.empty() || wrong_password.at("mappings").size() != 1) {
    mapper.stop();
    target_client.stop();
    if (target_thread.joinable()) target_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }
  {
    asio::io_context context;
    Tcp::socket unauthorized(context);
    unauthorized.connect(Tcp::endpoint(asio::ip::address_v4::loopback(), listener_port));
    std::this_thread::sleep_for(std::chrono::milliseconds(250));
    unauthorized.close();
  }
  if (std::filesystem::exists(trust_file)) {
    mapper.stop();
    target_client.stop();
    if (target_thread.joinable()) target_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }

  error.clear();
  const auto authorized = mapper.handle_request("PUT", "/api/mappings/integration", {
      {"name", "integration"}, {"protocol", "tcp"}, {"listenPort", listener_port},
      {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", echo.port()},
      {"targetPassword", "target-login-secret"}, {"enabled", true},
  }, error);
  if (!error.empty() || authorized.at("mappings").size() != 1) {
    mapper.stop();
    target_client.stop();
    if (target_thread.joinable()) target_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }

  asio::io_context context;
  Tcp::socket local(context);
  local.connect(Tcp::endpoint(asio::ip::address_v4::loopback(), listener_port));
  const std::string payload("binary\0relay", 12);
  asio::write(local, asio::buffer(payload));
  std::array<char, 12> response{};
  asio::read(local, asio::buffer(response));
  const bool relayed = std::string(response.data(), response.size()) == payload && echo.completed();
  local.shutdown(Tcp::socket::shutdown_both);
  local.close();
  mapper.stop();
  target_client.stop();
  if (target_thread.joinable()) target_thread.join();
  if (!relayed) {
    std::filesystem::remove_all(directory);
    std::cerr << "native source-to-target tunnel did not relay binary data\n";
    return 1;
  }

  EchoServer rotated_echo;
  std::string rotated_verifier;
  if (!plugmesh::make_local_ui_password_verifier("rotated-target-secret", rotated_verifier, error)) {
    std::filesystem::remove_all(directory);
    return 1;
  }
  target_config.local_ui_password_verifier = rotated_verifier;
  plugmesh::PluginManager rotated_plugins;
  plugmesh::ControlClient rotated_client(target_config, rotated_plugins);
  std::string rotated_error;
  std::thread rotated_thread([&] { rotated_client.run(rotated_error); });
  if (!wait_for([&] { return rotated_client.connected(); }, std::chrono::seconds(3))) {
    rotated_client.stop();
    if (rotated_thread.joinable()) rotated_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }
  error.clear();
  const auto reauthorized = mapper.handle_request("PUT", "/api/mappings/integration", {
      {"name", "integration"}, {"protocol", "tcp"}, {"listenPort", listener_port},
      {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", rotated_echo.port()},
      {"targetPassword", "rotated-target-secret"}, {"enabled", true},
  }, error);
  if (!error.empty() || reauthorized.at("mappings").size() != 1) {
    mapper.stop();
    rotated_client.stop();
    if (rotated_thread.joinable()) rotated_thread.join();
    std::filesystem::remove_all(directory);
    return 1;
  }
  asio::io_context rotated_context;
  Tcp::socket rotated_local(rotated_context);
  rotated_local.connect(Tcp::endpoint(asio::ip::address_v4::loopback(), listener_port));
  asio::write(rotated_local, asio::buffer(payload));
  std::array<char, 12> rotated_response{};
  asio::read(rotated_local, asio::buffer(rotated_response));
  const bool rotated_ok = std::string(rotated_response.data(), rotated_response.size()) == payload && rotated_echo.completed();
  rotated_local.shutdown(Tcp::socket::shutdown_both);
  rotated_local.close();
  mapper.stop();
  rotated_client.stop();
  if (rotated_thread.joinable()) rotated_thread.join();
  std::filesystem::remove_all(directory);
  if (!rotated_ok) {
    std::cerr << "rotated target authorization did not relay binary data\n";
    return 1;
  }
  return 0;
}
