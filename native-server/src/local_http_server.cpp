#include "plugmesh/local_http_server.h"

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <nlohmann/json.hpp>

namespace plugmesh {

namespace {

using Server = websocketpp::server<websocketpp::config::asio>;

}  // namespace

LocalHttpServer::LocalHttpServer(uint16_t port) : port_(port) {}

bool LocalHttpServer::run(std::string& error) {
  stopping_ = false;
  auto server = std::make_unique<Server>();
  server_.store(server.get(), std::memory_order_release);
  server->clear_access_channels(websocketpp::log::alevel::all);
  server->clear_error_channels(websocketpp::log::elevel::all);
  server->init_asio();
  server->set_http_handler([this](websocketpp::connection_hdl handle) { handle_http(handle.lock().get()); });
  try {
    const auto address = websocketpp::lib::asio::ip::address::from_string("127.0.0.1");
    server->listen(websocketpp::lib::asio::ip::tcp::endpoint(address, port_));
    server->start_accept();
    server->run();
  } catch (const websocketpp::exception& exception) {
    error = exception.what();
    server_.store(nullptr, std::memory_order_release);
    return false;
  }
  server_.store(nullptr, std::memory_order_release);
  return !stopping_;
}

void LocalHttpServer::stop() {
  stopping_ = true;
  auto* server = static_cast<Server*>(server_.load(std::memory_order_acquire));
  if (server) server->stop();
}

void LocalHttpServer::handle_http(void* handle) {
  auto* connection = static_cast<websocketpp::connection<websocketpp::config::asio>*>(handle);
  if (!connection) return;
  const auto resource = connection->get_resource();
  if (resource == "/api/health") {
    connection->set_status(websocketpp::http::status_code::ok);
    connection->append_header("Content-Type", "application/json; charset=utf-8");
    connection->set_body(nlohmann::json{{"ok", true}, {"service", "plugmesh-local-server"}, {"port", port_}}.dump());
  } else {
    connection->set_status(websocketpp::http::status_code::not_found);
    connection->append_header("Content-Type", "text/plain; charset=utf-8");
    connection->set_body("Not found");
  }
}

}  // namespace plugmesh
