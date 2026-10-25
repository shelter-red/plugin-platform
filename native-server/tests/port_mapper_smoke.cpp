#include "plugmesh/port_mapper.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/server_config.h"
#include "plugmesh/tunnel_protocol.h"
#include "plugmesh/tunnel_trust_store.h"

#include <asio.hpp>
#include <nlohmann/json.hpp>
#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <array>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <thread>

namespace {
using Tcp = asio::ip::tcp;
using Worker = websocketpp::server<websocketpp::config::asio>;

uint16_t unused_port() {
  asio::io_context context;
  Tcp::acceptor acceptor(context, Tcp::endpoint(asio::ip::address_v4::loopback(), 0));
  return acceptor.local_endpoint().port();
}

class MockWorker {
 public:
  MockWorker() {
    std::string verifier_error;
    if (!plugmesh::make_local_ui_password_verifier("target-login-secret", verifier_, verifier_error) || !plugmesh::make_local_ui_password_challenge(verifier_, challenge_, verifier_error)) throw std::runtime_error(verifier_error);
    worker_.clear_access_channels(websocketpp::log::alevel::all);
    worker_.clear_error_channels(websocketpp::log::elevel::all);
    worker_.init_asio();
    worker_.set_http_handler([this](websocketpp::connection_hdl handle) {
      const auto connection = worker_.get_con_from_hdl(handle);
      connection->set_status(websocketpp::http::status_code::ok);
      connection->set_body(R"({"results":[{"id":"target","name":"target","status":"online"}]})");
    });
    worker_.set_open_handler([this](websocketpp::connection_hdl handle) {
      websocketpp::lib::error_code error;
      worker_.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kSessionId, "test-session"), websocketpp::frame::opcode::binary, error);
      if (authorized_) worker_.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kReady), websocketpp::frame::opcode::binary, error);
      else worker_.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kPasswordRequired, challenge_.dump()), websocketpp::frame::opcode::binary, error);
    });
    worker_.set_message_handler([this](websocketpp::connection_hdl handle, Worker::message_ptr message) {
      uint8_t type = 0;
      std::string payload;
      if (message->get_opcode() != websocketpp::frame::opcode::binary || !plugmesh::tunnel::parse(message->get_payload(), type, payload)) return;
      if (type == plugmesh::tunnel::kAuthenticate) {
        const auto valid = plugmesh::verify_local_ui_password_proof(verifier_, challenge_, "source\ntarget\ntest-session", payload);
        authorized_ = valid;
        websocketpp::lib::error_code error;
        worker_.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kAuthResult, std::string(1, valid ? '\1' : '\0')), websocketpp::frame::opcode::binary, error);
        if (!valid) worker_.close(handle, websocketpp::close::status::policy_violation, "Target authorization failed", error);
      } else if (type == plugmesh::tunnel::kData && authorized_) {
        websocketpp::lib::error_code error;
        worker_.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kData, payload), websocketpp::frame::opcode::binary, error);
      } else if (type == plugmesh::tunnel::kFin && authorized_) {
        websocketpp::lib::error_code error;
        worker_.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kFin), websocketpp::frame::opcode::binary, error);
      }
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
  bool authorized() const { return authorized_.load(); }

 private:
  Worker worker_;
  uint16_t port_{};
  std::thread thread_;
  std::string verifier_;
  nlohmann::json challenge_;
  std::atomic<bool> authorized_{false};
};

}  // namespace

int main() {
  plugmesh::PortMapper disabled;
  plugmesh::ServerConfig empty_config;
  std::string error;
  if (!disabled.start(empty_config, error) || disabled.snapshot() != "[]") return 1;
  disabled.stop();

  MockWorker worker;
  const auto directory = std::filesystem::temp_directory_path() / ("plugmesh-tunnel-mapping-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  std::filesystem::create_directories(directory);
  const auto config_path = directory / "mappings.json";
  const auto listen_port = unused_port();
  {
    std::ofstream output(config_path);
    output << nlohmann::json{{"mappings", nlohmann::json::array({{{"name", "echo"}, {"protocol", "tcp"}, {"listenPort", listen_port}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 22}}})}}.dump();
  }

  plugmesh::ServerConfig server_config;
  server_config.worker_url = "http://127.0.0.1:" + std::to_string(worker.port());
  server_config.server_id = "source";
  server_config.access_token = "test-token";
  server_config.port_mappings_file = config_path;
  plugmesh::PortMapper mapper;
  if (!mapper.start(server_config, error)) {
    std::cerr << "embedded mapper failed to start: " << error << '\n';
    return 1;
  }
  if (nlohmann::json::parse(mapper.snapshot()).size() != 1) return 1;

  error.clear();
  const auto authorized_mapping = mapper.handle_request("PUT", "/api/mappings/echo", nlohmann::json{{"name", "echo"}, {"protocol", "tcp"}, {"listenPort", listen_port}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 22}, {"targetPassword", "target-login-secret"}, {"enabled", true}}, error);
  if (!error.empty() || authorized_mapping.at("mappings").size() != 1) {
    std::cerr << "mapping authorization configuration failed: " << error << '\n';
    return 1;
  }

  plugmesh::PortMapper conflicting_mapper;
  error.clear();
  const auto oversized_password = mapper.handle_request("POST", "/api/mappings", nlohmann::json{{"name", "oversized"}, {"protocol", "tcp"}, {"listenPort", unused_port()}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 22}, {"targetPassword", std::string(1025, 'x')}}, error);
  if (error != "target server password is too long" || !oversized_password.empty()) {
    std::cerr << "oversized target password should be rejected before persistence\n";
    return 1;
  }

  if (conflicting_mapper.start(server_config, error) || error.empty()) {
    std::cerr << "conflicting listener port should fail startup\n";
    return 1;
  }

  asio::io_context context;
  Tcp::socket socket(context);
  socket.connect(Tcp::endpoint(asio::ip::address_v4::loopback(), listen_port));
  const std::string payload("binary\0payload", 14);
  asio::write(socket, asio::buffer(payload));
  std::array<char, 64> response{};
  asio::read(socket, asio::buffer(response.data(), payload.size()));
  if (std::string(response.data(), payload.size()) != payload) {
    std::cerr << "binary TCP payload was not returned by the mock Worker tunnel\n";
    return 1;
  }
  if (!worker.authorized()) {
    std::cerr << "target password challenge was not completed\n";
    return 1;
  }
  socket.shutdown(Tcp::socket::shutdown_both);
  socket.close();

  // The target has already trusted this source server; a second connection must not resend a password.
  asio::io_context reconnect_context;
  Tcp::socket reconnect(reconnect_context);
  reconnect.connect(Tcp::endpoint(asio::ip::address_v4::loopback(), listen_port));
  asio::write(reconnect, asio::buffer(payload));
  std::array<char, 64> reconnect_response{};
  asio::read(reconnect, asio::buffer(reconnect_response.data(), payload.size()));
  if (std::string(reconnect_response.data(), payload.size()) != payload) {
    std::cerr << "trusted target reconnect did not complete without a password\n";
    return 1;
  }
  reconnect.shutdown(Tcp::socket::shutdown_both);
  reconnect.close();
  error.clear();
  const auto second_port = unused_port();
  const auto created = mapper.handle_request("POST", "/api/mappings", nlohmann::json{{"name", "second"}, {"protocol", "tcp"}, {"listenPort", second_port}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 2222}, {"targetPassword", "target-login-secret"}}, error);
  if (!error.empty() || created.at("mappings").size() != 2) {
    std::cerr << "mapping API failed to persist and start a mapping: " << error << '\n';
    return 1;
  }
  {
    std::ifstream saved_config(config_path);
    const std::string contents(std::istreambuf_iterator<char>(saved_config), {});
    if (contents.find("target-login-secret") != std::string::npos) {
      std::cerr << "target server password was persisted in the mapping configuration\n";
      return 1;
    }
  }
  error.clear();
  const auto conflict = mapper.handle_request("PUT", "/api/mappings/second", nlohmann::json{{"name", "second"}, {"protocol", "tcp"}, {"listenPort", listen_port}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 2222}, {"enabled", true}}, error);
  if (error.empty() || nlohmann::json::parse(mapper.snapshot()).size() != 2 || !conflict.empty()) {
    std::cerr << "invalid conflicting update should preserve the active mappings\n";
    return 1;
  }
  error.clear();
  const auto stopped = mapper.handle_request("PUT", "/api/mappings/second", nlohmann::json{{"name", "second"}, {"protocol", "tcp"}, {"listenPort", second_port}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 2222}, {"enabled", false}}, error);
  if (!error.empty() || stopped.at("mappings").at(1).at("state") != "stopped") {
    std::cerr << "mapping API failed to stop the listener: " << error << '\n';
    return 1;
  }
  asio::io_context disabled_context;
  Tcp::acceptor disabled_probe(disabled_context);
  disabled_probe.open(Tcp::v4());
  disabled_probe.bind(Tcp::endpoint(asio::ip::address_v4::loopback(), second_port));
  disabled_probe.close();
  error.clear();
  const auto restarted = mapper.handle_request("PUT", "/api/mappings/second", nlohmann::json{{"name", "second"}, {"protocol", "tcp"}, {"listenPort", second_port}, {"targetServerId", "target"}, {"targetHost", "127.0.0.1"}, {"targetPort", 2222}, {"enabled", true}}, error);
  if (!error.empty() || restarted.at("mappings").at(1).at("state") != "listening") {
    std::cerr << "mapping API failed to restart the listener: " << error << '\n';
    return 1;
  }
  error.clear();
  const auto removed = mapper.handle_request("DELETE", "/api/mappings/second", nlohmann::json::object(), error);
  if (!error.empty() || removed.at("mappings").size() != 1) {
    std::cerr << "mapping API failed to remove a mapping: " << error << '\n';
    return 1;
  }
  const auto trust_path = directory / "tunnel-trust.json";
  std::string verifier_a;
  std::string verifier_b;
  if (!plugmesh::make_local_ui_password_verifier("target-password-a", verifier_a, error) || !plugmesh::make_local_ui_password_verifier("target-password-b", verifier_b, error)) return 1;
  plugmesh::TunnelTrustStore trust_a;
  if (!trust_a.load(trust_path, verifier_a, error) || !trust_a.trust("source", error) || !trust_a.trusts("source")) return 1;
  plugmesh::TunnelTrustStore trust_rotated;
  if (!trust_rotated.load(trust_path, verifier_b, error) || trust_rotated.trusts("source")) {
    std::cerr << "password verifier rotation did not invalidate old tunnel trust\n";
    return 1;
  }
  plugmesh::TunnelTrustStore trust_after_rotation;
  if (!trust_after_rotation.load(trust_path, verifier_a, error) || trust_after_rotation.trusts("source")) {
    std::cerr << "rotated tunnel trust was unexpectedly retained\n";
    return 1;
  }
  mapper.stop();
  conflicting_mapper.stop();
  std::filesystem::remove_all(directory);
  return 0;
}
