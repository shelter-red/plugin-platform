#include "plugmesh/local_http_server.h"

#include "plugmesh/credential_store.h"
#include "plugmesh/plugin_manager.h"

#include <websocketpp/config/asio_no_tls.hpp>
#include <websocketpp/server.hpp>

#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/rand.h>

#include <array>
#include <chrono>
#include <fstream>
#include <iomanip>
#include <iterator>
#include <sstream>
#include <string_view>

namespace plugmesh {

namespace {

using Server = websocketpp::server<websocketpp::config::asio>;
constexpr char kSessionCookieName[] = "plugmesh_session";
constexpr std::size_t kSessionTokenBytes = 32;
constexpr std::size_t kMaxFailedLogins = 5;
constexpr auto kFailedLoginWindow = std::chrono::seconds(60);

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
      {"lastError", plugin.last_error},
  };
}

void set_json_response(websocketpp::connection<websocketpp::config::asio>* connection, websocketpp::http::status_code::value status, const nlohmann::json& body) {
  connection->set_status(status);
  connection->append_header("Content-Type", "application/json; charset=utf-8");
  connection->set_body(body.dump());
}

const char* content_type(const std::filesystem::path& path) {
  const auto extension = path.extension().string();
  if (extension == ".html") return "text/html; charset=utf-8";
  if (extension == ".css") return "text/css; charset=utf-8";
  if (extension == ".js") return "text/javascript; charset=utf-8";
  if (extension == ".json") return "application/json; charset=utf-8";
  if (extension == ".svg") return "image/svg+xml";
  if (extension == ".ico") return "image/x-icon";
  if (extension == ".woff" || extension == ".woff2") return "font/woff2";
  return "application/octet-stream";
}

bool contains_parent_segment(const std::string& resource) {
  if (resource.find('\\') != std::string::npos) return true;
  std::size_t start = 0;
  while (start <= resource.size()) {
    const auto end = resource.find('/', start);
    const auto segment = resource.substr(start, end == std::string::npos ? std::string::npos : end - start);
    if (segment == "..") return true;
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return false;
}

std::string cookie_value(const std::string& cookie_header, const std::string_view name) {
  std::size_t start = 0;
  while (start < cookie_header.size()) {
    const auto end = cookie_header.find(';', start);
    auto item = std::string_view(cookie_header).substr(start, end == std::string::npos ? std::string::npos : end - start);
    while (!item.empty() && (item.front() == ' ' || item.front() == '\t')) item.remove_prefix(1);
    while (!item.empty() && (item.back() == ' ' || item.back() == '\t')) item.remove_suffix(1);
    const auto separator = item.find('=');
    if (separator != std::string_view::npos && item.substr(0, separator) == name) return std::string(item.substr(separator + 1));
    if (end == std::string::npos) break;
    start = end + 1;
  }
  return {};
}

}  // namespace

LocalHttpServer::LocalHttpServer(uint16_t port, PluginManager* plugins, StatusProvider status_provider, std::filesystem::path ui_directory, RegistrationHandler registration_handler, LogProvider log_provider, CredentialActionHandler credential_action_handler, std::string local_ui_password_verifier, PasswordSetupHandler password_setup_handler)
    : port_(port), plugins_(plugins), status_provider_(std::move(status_provider)), ui_directory_(std::move(ui_directory)), registration_handler_(std::move(registration_handler)), log_provider_(std::move(log_provider)), credential_action_handler_(std::move(credential_action_handler)), local_ui_password_verifier_(std::move(local_ui_password_verifier)), password_setup_handler_(std::move(password_setup_handler)) {}

bool LocalHttpServer::run(std::string& error) {
  stopping_ = false;
  auto server = std::make_unique<Server>();
  server_.store(server.get(), std::memory_order_release);
  server->clear_access_channels(websocketpp::log::alevel::all);
  server->clear_error_channels(websocketpp::log::elevel::all);
  server->init_asio();
  server->set_reuse_addr(true);
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

bool LocalHttpServer::has_active_requests() const {
  return active_requests_.load(std::memory_order_acquire) != 0;
}

bool LocalHttpServer::serve_static(void* handle, const std::string& resource, bool& forbidden) const {
  forbidden = false;
  if (ui_directory_.empty()) return false;
  auto* connection = static_cast<websocketpp::connection<websocketpp::config::asio>*>(handle);
  if (!connection || contains_parent_segment(resource)) {
    forbidden = true;
    return false;
  }

  const auto relative = resource == "/" ? std::filesystem::path("index.html") : std::filesystem::path(resource.substr(1));
  const auto is_asset = resource.rfind("/assets/", 0) == 0;
  std::error_code error;
  const auto root = std::filesystem::weakly_canonical(ui_directory_, error);
  if (error || !std::filesystem::is_directory(root, error)) return false;
  auto candidate = std::filesystem::weakly_canonical(root / relative, error);
  if (error) return false;
  const auto root_string = root.generic_string();
  const auto candidate_string = candidate.generic_string();
  if (candidate_string != root_string && candidate_string.rfind(root_string + '/', 0) != 0) {
    forbidden = true;
    return false;
  }

  if (!std::filesystem::is_regular_file(candidate, error)) {
    if (is_asset) return false;
    candidate = std::filesystem::weakly_canonical(root / "index.html", error);
    if (error || !std::filesystem::is_regular_file(candidate, error)) return false;
  }
  if (std::filesystem::file_size(candidate, error) > 10 * 1024 * 1024 || error) {
    connection->set_status(websocketpp::http::status_code::request_entity_too_large);
    connection->set_body("Static resource is too large");
    return true;
  }

  std::ifstream input(candidate, std::ios::binary);
  if (!input) return false;
  std::string body((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
  connection->set_status(websocketpp::http::status_code::ok);
  connection->append_header("Content-Type", content_type(candidate));
  connection->append_header("Cache-Control", is_asset ? "public, max-age=31536000, immutable" : "no-cache");
  connection->set_body(std::move(body));
  return true;
}

bool LocalHttpServer::is_authenticated(const std::string& cookie_header) const {
  const auto token = cookie_value(cookie_header, kSessionCookieName);
  std::lock_guard lock(session_mutex_);
  return !token.empty() && token.size() == session_token_.size() && !session_token_.empty() && CRYPTO_memcmp(token.data(), session_token_.data(), token.size()) == 0;
}

bool LocalHttpServer::login_rate_limited() {
  const auto cutoff = std::chrono::steady_clock::now() - kFailedLoginWindow;
  std::lock_guard lock(session_mutex_);
  while (!failed_logins_.empty() && failed_logins_.front() <= cutoff) failed_logins_.pop_front();
  return failed_logins_.size() >= kMaxFailedLogins;
}

void LocalHttpServer::record_failed_login() {
  std::lock_guard lock(session_mutex_);
  failed_logins_.push_back(std::chrono::steady_clock::now());
}

bool LocalHttpServer::create_session(std::string& token, std::string& error) {
  std::array<unsigned char, kSessionTokenBytes> bytes{};
  if (RAND_bytes(bytes.data(), static_cast<int>(bytes.size())) != 1) {
    error = "unable to generate local UI session";
    return false;
  }
  std::ostringstream encoded;
  encoded << std::hex << std::setfill('0');
  for (const auto byte : bytes) encoded << std::setw(2) << static_cast<unsigned int>(byte);
  token = encoded.str();
  std::lock_guard lock(session_mutex_);
  session_token_ = token;
  failed_logins_.clear();
  return true;
}

void LocalHttpServer::clear_session(const std::string& cookie_header) {
  const auto token = cookie_value(cookie_header, kSessionCookieName);
  std::lock_guard lock(session_mutex_);
  if (!token.empty() && token.size() == session_token_.size() && !session_token_.empty() && CRYPTO_memcmp(token.data(), session_token_.data(), token.size()) == 0) session_token_.clear();
}

void LocalHttpServer::handle_http(void* handle) {
  auto* connection = static_cast<websocketpp::connection<websocketpp::config::asio>*>(handle);
  if (!connection) return;
  active_requests_.fetch_add(1, std::memory_order_acq_rel);
  struct RequestGuard {
    std::atomic<std::size_t>& active_requests;
    ~RequestGuard() { active_requests.fetch_sub(1, std::memory_order_acq_rel); }
  } request_guard{active_requests_};
  const auto method = connection->get_request().get_method();
  const auto raw_resource = connection->get_resource();
  const auto query_start = raw_resource.find('?');
  const auto resource = raw_resource.substr(0, query_start);

  auto status = status_provider_ ? status_provider_() : nlohmann::json::object();
  status["ok"] = true;
  status["service"] = "plugmesh-local-server";
  status["port"] = port_;
  const auto configured = status.value("configured", false);
  const auto cookie_header = connection->get_request().get_header("Cookie");

  if (resource == "/api/session/password") {
    connection->append_header("Cache-Control", "no-store");
    if (method != "POST") {
      set_json_response(connection, websocketpp::http::status_code::method_not_allowed, {{"ok", false}, {"error", "method not allowed"}, {"code", "method_not_allowed"}});
      return;
    }
    if (!configured || !local_ui_password_verifier_.empty() || !password_setup_handler_) {
      set_json_response(connection, websocketpp::http::status_code::conflict, {{"ok", false}, {"error", "local UI password setup is unavailable"}, {"code", "password_setup_unavailable"}});
      return;
    }
    if (login_rate_limited()) {
      connection->append_header("Retry-After", "60");
      set_json_response(connection, websocketpp::http::status_code::too_many_requests, {{"ok", false}, {"error", "too many password setup attempts"}, {"code", "too_many_password_attempts"}});
      return;
    }
    const auto body = connection->get_request_body();
    if (body.size() > 16 * 1024) {
      set_json_response(connection, websocketpp::http::status_code::request_entity_too_large, {{"ok", false}, {"error", "password setup request is too large"}, {"code", "payload_too_large"}});
      return;
    }
    try {
      const auto payload = nlohmann::json::parse(body.empty() ? "{}" : body);
      if (!payload.is_object()) {
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "password setup payload must be an object"}, {"code", "invalid_payload"}});
        return;
      }
      const auto password = payload.value("password", std::string());
      const auto confirmation = payload.value("passwordConfirmation", std::string());
      if (password.size() < 8 || password != confirmation) {
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", password.size() < 8 ? "local UI password must contain at least 8 characters" : "local UI password confirmation does not match"}, {"code", password.size() < 8 ? "password_too_short" : "password_mismatch"}});
        return;
      }
      std::string verifier;
      std::string error;
      if (!make_local_ui_password_verifier(password, verifier, error) || !password_setup_handler_(verifier, payload, error)) {
        record_failed_login();
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", error.empty() ? "unable to save local UI password" : error}, {"code", "password_setup_failed"}});
        return;
      }
      local_ui_password_verifier_ = verifier;
      std::string token;
      if (!create_session(token, error)) {
        set_json_response(connection, websocketpp::http::status_code::internal_server_error, {{"ok", false}, {"error", error}, {"code", "session_creation_failed"}});
        return;
      }
      connection->append_header("Set-Cookie", std::string(kSessionCookieName) + "=" + token + "; Path=/; HttpOnly; SameSite=Strict");
      set_json_response(connection, websocketpp::http::status_code::ok, {{"ok", true}, {"authenticated", true}, {"passwordConfigured", true}});
    } catch (const nlohmann::json::exception&) {
      set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "password setup payload must be valid JSON"}, {"code", "invalid_payload"}});
    }
    return;
  }

  if (resource == "/api/session") {
    connection->append_header("Cache-Control", "no-store");
    if (method == "GET") {
      set_json_response(connection, websocketpp::http::status_code::ok, {
          {"ok", true},
          {"authenticated", is_authenticated(cookie_header)},
          {"configured", configured},
          {"passwordConfigured", !local_ui_password_verifier_.empty()},
          {"passwordSetupRequired", configured && local_ui_password_verifier_.empty()},
      });
      return;
    }
    if (method == "POST") {
      if (local_ui_password_verifier_.empty()) {
        set_json_response(connection, websocketpp::http::status_code::conflict, {{"ok", false}, {"error", "local UI password is not configured"}, {"code", "password_setup_required"}});
        return;
      }
      if (login_rate_limited()) {
        connection->append_header("Retry-After", "60");
        set_json_response(connection, websocketpp::http::status_code::too_many_requests, {{"ok", false}, {"error", "too many login attempts"}, {"code", "too_many_login_attempts"}});
        return;
      }
      const auto body = connection->get_request_body();
      if (body.size() > 4 * 1024) {
        set_json_response(connection, websocketpp::http::status_code::request_entity_too_large, {{"ok", false}, {"error", "session request is too large"}, {"code", "payload_too_large"}});
        return;
      }
      try {
        const auto payload = nlohmann::json::parse(body.empty() ? "{}" : body);
        const auto password = payload.is_object() ? payload.value("password", std::string()) : std::string();
        if (!verify_local_ui_password(password, local_ui_password_verifier_)) {
          record_failed_login();
          set_json_response(connection, websocketpp::http::status_code::unauthorized, {{"ok", false}, {"error", "invalid local UI password"}, {"code", "invalid_password"}});
          return;
        }
        std::string token;
        std::string error;
        if (!create_session(token, error)) {
          set_json_response(connection, websocketpp::http::status_code::internal_server_error, {{"ok", false}, {"error", error}, {"code", "session_creation_failed"}});
          return;
        }
        connection->append_header("Set-Cookie", std::string(kSessionCookieName) + "=" + token + "; Path=/; HttpOnly; SameSite=Strict");
        set_json_response(connection, websocketpp::http::status_code::ok, {{"ok", true}, {"authenticated", true}});
      } catch (const nlohmann::json::exception&) {
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "session payload must be valid JSON"}, {"code", "invalid_payload"}});
      }
      return;
    }
    if (method == "DELETE") {
      clear_session(cookie_header);
      connection->append_header("Set-Cookie", std::string(kSessionCookieName) + "=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0");
      set_json_response(connection, websocketpp::http::status_code::ok, {{"ok", true}, {"authenticated", false}});
      return;
    }
    set_json_response(connection, websocketpp::http::status_code::method_not_allowed, {{"ok", false}, {"error", "method not allowed"}, {"code", "method_not_allowed"}});
    return;
  }

  if (method == "GET" && resource.rfind("/api/", 0) != 0) {
    bool forbidden = false;
    if (serve_static(handle, resource, forbidden)) return;
    if (forbidden) {
      set_json_response(connection, websocketpp::http::status_code::forbidden, {{"ok", false}, {"error", "forbidden path"}, {"code", "forbidden_path"}});
      return;
    }
  }

  if (resource.rfind("/api/", 0) == 0) {
    const auto setup_endpoint = !configured && (resource == "/api/health" || resource == "/api/status" || resource == "/api/register");
    if (!setup_endpoint && !is_authenticated(cookie_header)) {
      connection->append_header("Cache-Control", "no-store");
      const auto password_setup_required = configured && local_ui_password_verifier_.empty();
      set_json_response(connection, websocketpp::http::status_code::unauthorized, {
          {"ok", false},
          {"error", password_setup_required ? "local UI password setup is required" : "authentication required"},
          {"code", password_setup_required ? "password_setup_required" : "authentication_required"},
      });
      return;
    }
  }

  if (method == "GET" && (resource == "/api/health" || resource == "/api/status")) {
    set_json_response(connection, websocketpp::http::status_code::ok, status);
    return;
  }

  if (method == "POST" && resource == "/api/register") {
    if (!registration_handler_) {
      set_json_response(connection, websocketpp::http::status_code::not_found, {{"ok", false}, {"error", "registration is unavailable"}, {"code", "registration_unavailable"}});
      return;
    }
    const auto body = connection->get_request_body();
    if (body.size() > 16 * 1024) {
      set_json_response(connection, websocketpp::http::status_code::request_entity_too_large, {{"ok", false}, {"error", "registration request is too large"}, {"code", "payload_too_large"}});
      return;
    }
    try {
      const auto payload = nlohmann::json::parse(body.empty() ? "{}" : body);
      if (!payload.is_object()) {
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "registration payload must be an object"}, {"code", "invalid_payload"}});
        return;
      }
      std::string error;
      auto result = registration_handler_(payload, error);
      if (!error.empty()) set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", error}, {"code", "registration_failed"}});
      else {
        result["ok"] = true;
        set_json_response(connection, websocketpp::http::status_code::created, result);
      }
    } catch (const nlohmann::json::exception&) {
      set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "registration payload must be valid JSON"}, {"code", "invalid_payload"}});
    }
    return;
  }

  if (method == "POST" && (resource == "/api/credentials/rotate" || resource == "/api/credentials/revoke")) {
    if (!credential_action_handler_) {
      set_json_response(connection, websocketpp::http::status_code::not_found, {{"ok", false}, {"error", "credential actions are unavailable"}, {"code", "credential_actions_unavailable"}});
      return;
    }
    const auto body = connection->get_request_body();
    if (body.size() > 16 * 1024) {
      set_json_response(connection, websocketpp::http::status_code::request_entity_too_large, {{"ok", false}, {"error", "credential action request is too large"}, {"code", "payload_too_large"}});
      return;
    }
    try {
      const auto payload = nlohmann::json::parse(body.empty() ? "{}" : body);
      if (!payload.is_object()) {
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "credential action payload must be an object"}, {"code", "invalid_payload"}});
        return;
      }
      const auto action = resource.ends_with("/rotate") ? "rotate" : "revoke";
      std::string error;
      auto result = credential_action_handler_(action, payload, error);
      if (!error.empty()) {
        set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", error}, {"code", "credential_action_failed"}});
      } else {
        result["ok"] = true;
        set_json_response(connection, websocketpp::http::status_code::ok, result);
      }
    } catch (const nlohmann::json::exception&) {
      set_json_response(connection, websocketpp::http::status_code::bad_request, {{"ok", false}, {"error", "credential action payload must be valid JSON"}, {"code", "invalid_payload"}});
    }
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

  if (method == "GET" && resource == "/api/logs") {
    const auto logs = log_provider_ ? log_provider_() : nlohmann::json::array();
    set_json_response(connection, websocketpp::http::status_code::ok, {{"logs", logs}});
    return;
  }

  constexpr std::string_view prefix = "/api/plugins/";
  if ((method == "GET" || method == "POST") && plugins_ && resource.rfind(prefix, 0) == 0) {
    const auto operation = resource.substr(prefix.size());
    constexpr std::string_view health_suffix = "/health";
    if (operation.size() > health_suffix.size() && operation.ends_with(health_suffix)) {
      const auto plugin_id = operation.substr(0, operation.size() - health_suffix.size());
      plugmesh_http_response response{};
      std::string error;
      const auto ok = plugins_->health(plugin_id, response, error);
      auto result = nlohmann::json{{"ok", ok}, {"pluginId", plugin_id}, {"status", response.status}, {"bodySize", response.body.size}};
      if (!ok) {
        result["error"] = error;
        result["code"] = "health_check_failed";
      }
      set_json_response(connection, ok ? websocketpp::http::status_code::ok : websocketpp::http::status_code::bad_request, result);
      return;
    }
  }

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
        set_json_response(connection, websocketpp::http::status_code::not_found, {{"ok", false}, {"error", "unknown plugin action"}, {"code", "unknown_plugin_action"}});
        return;
      }
      const auto info = plugins_->info_snapshot(plugin_id);
      auto response = nlohmann::json{{"ok", ok}, {"pluginId", plugin_id}, {"action", action}, {"state", info ? plugin_state_name(info->state) : "unknown"}};
      if (!ok) {
        response["error"] = error;
        response["code"] = "plugin_action_failed";
      }
      set_json_response(connection, ok ? websocketpp::http::status_code::ok : websocketpp::http::status_code::bad_request, response);
      return;
    }
  }

  if (method != "GET" && method != "POST" && method != "DELETE") {
    set_json_response(connection, websocketpp::http::status_code::method_not_allowed, {{"ok", false}, {"error", "method not allowed"}, {"code", "method_not_allowed"}});
    return;
  }

  set_json_response(connection, websocketpp::http::status_code::not_found, {{"ok", false}, {"error", "not found"}, {"code", "not_found"}});
}

}  // namespace plugmesh
