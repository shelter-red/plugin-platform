#include "plugmesh/local_http_server.h"

#include "plugmesh/plugin_manager.h"

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <nlohmann/json.hpp>

#include <string_view>

namespace plugmesh {

namespace {

using Server = websocketpp::server<websocketpp::config::asio>;

nlohmann::json plugin_json(const PluginInfo& plugin) {
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
  };
}

void set_json_response(websocketpp::connection<websocketpp::config::asio>* connection, websocketpp::http::status_code::value status, const nlohmann::json& body) {
  connection->set_status(status);
  connection->append_header("Content-Type", "application/json; charset=utf-8");
  connection->set_body(body.dump());
}

}  // namespace

LocalHttpServer::LocalHttpServer(uint16_t port, PluginManager* plugins, StatusProvider status_provider)
    : port_(port), plugins_(plugins), status_provider_(std::move(status_provider)) {}

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
  const auto method = connection->get_request().get_method();
  const auto raw_resource = connection->get_resource();
  const auto query_start = raw_resource.find('?');
  const auto resource = raw_resource.substr(0, query_start);

  auto status = status_provider_ ? status_provider_() : nlohmann::json::object();
  status["ok"] = true;
  status["service"] = "plugmesh-local-server";
  status["port"] = port_;

  if (method == "GET" && (resource == "/api/health" || resource == "/api/status")) {
    set_json_response(connection, websocketpp::http::status_code::ok, status);
    return;
  }

  if (method == "GET" && resource == "/api/plugins") {
    nlohmann::json plugins = nlohmann::json::array();
    if (plugins_) {
      for (const auto& plugin : plugins_->snapshot()) plugins.push_back(plugin_json(plugin));
    }
    set_json_response(connection, websocketpp::http::status_code::ok, {{"plugins", std::move(plugins)}});
    return;
  }

  if (method == "GET" && resource == "/api/diagnostics") {
    const auto plugins = plugins_ ? plugins_->snapshot() : std::vector<PluginInfo>{};
    std::size_t loaded = 0;
    std::size_t enabled = 0;
    std::size_t failed = 0;
    for (const auto& plugin : plugins) {
      if (plugin.state != PluginState::Discovered && plugin.state != PluginState::Unloaded) ++loaded;
      if (plugin.state == PluginState::Enabled) ++enabled;
      if (plugin.state == PluginState::Failed) ++failed;
    }
    status["pluginCount"] = plugins.size();
    status["loadedPluginCount"] = loaded;
    status["enabledPluginCount"] = enabled;
    status["failedPluginCount"] = failed;
    set_json_response(connection, websocketpp::http::status_code::ok, status);
    return;
  }

  constexpr std::string_view prefix = "/api/plugins/";
  if (method == "POST" && plugins_ && resource.rfind(prefix, 0) == 0) {
    const auto operation = resource.substr(prefix.size());
    const auto separator = operation.rfind('/');
    if (separator != std::string::npos && separator > 0 && separator + 1 < operation.size()) {
      const auto plugin_id = operation.substr(0, separator);
      const auto action = operation.substr(separator + 1);
      std::string error;
      bool ok = false;
      if (action == "load") ok = plugins_->load(plugin_id, error);
      else if (action == "unload") ok = plugins_->unload(plugin_id, error);
      else if (action == "enable") ok = plugins_->enable(plugin_id, error);
      else if (action == "disable") ok = plugins_->disable(plugin_id, error);
      else if (action == "reload") ok = plugins_->reload(plugin_id, error);
      else {
        set_json_response(connection, websocketpp::http::status_code::not_found, {{"ok", false}, {"error", "unknown plugin action"}});
        return;
      }
      const auto info = plugins_->info_snapshot(plugin_id);
      const auto response = nlohmann::json{{"ok", ok}, {"pluginId", plugin_id}, {"action", action}, {"state", info ? plugin_state_name(info->state) : "unknown"}, {"error", ok ? "" : error}};
      set_json_response(connection, ok ? websocketpp::http::status_code::ok : websocketpp::http::status_code::bad_request, response);
      return;
    }
  }

  if (method != "GET" && method != "POST") {
    set_json_response(connection, websocketpp::http::status_code::method_not_allowed, {{"ok", false}, {"error", "method not allowed"}});
    return;
  }

  set_json_response(connection, websocketpp::http::status_code::not_found, {{"ok", false}, {"error", "not found"}});
}

}  // namespace plugmesh
