#include "plugmesh/plugin_manager.h"

#include "plugmesh/plugin_host_client.h"
#include "plugmesh/plugin_host_protocol.h"

#include <algorithm>
#include <cstdlib>
#include <fstream>

#ifdef _WIN32
#include <windows.h>
#endif

namespace plugmesh {

namespace {

bool is_library(const std::filesystem::path& path) {
#ifdef _WIN32
  return path.extension() == ".dll";
#else
  return path.extension() == ".so";
#endif
}

bool is_within_directory(const std::filesystem::path& directory, const std::filesystem::path& path) {
  auto directory_part = directory.begin();
  auto path_part = path.begin();
  for (; directory_part != directory.end(); ++directory_part, ++path_part) {
    if (path_part == path.end() || *directory_part != *path_part) return false;
  }
  return path_part != path.end();
}

struct Manifest {
  std::string id;
  std::string name;
  std::string version;
  std::string abi_version;
  std::string library;
  std::string health_path;
  std::vector<std::string> permissions;
  bool http = false;
  bool websocket = false;
  bool sse = false;
  bool file_stream = false;
};

bool read_string(const nlohmann::json& value, const char* key, std::string& output, std::string& error) {
  if (!value.contains(key) || !value.at(key).is_string() || value.at(key).get<std::string>().empty()) {
    error = std::string("manifest field is required: ") + key;
    return false;
  }
  output = value.at(key).get<std::string>();
  return true;
}

bool read_manifest(const std::filesystem::path& path, Manifest& manifest, std::string& error) {
  std::ifstream input(path);
  if (!input) {
    error = "cannot open manifest: " + path.string();
    return false;
  }
  try {
    const auto value = nlohmann::json::parse(input);
    if (!value.is_object() || !read_string(value, "id", manifest.id, error) || !read_string(value, "name", manifest.name, error) || !read_string(value, "version", manifest.version, error) || !read_string(value, "abiVersion", manifest.abi_version, error) || !read_string(value, "library", manifest.library, error) || !read_string(value, "healthPath", manifest.health_path, error)) return false;
    if (manifest.abi_version != std::to_string(PLUGMESH_PLUGIN_ABI_VERSION) && manifest.abi_version != std::to_string(PLUGMESH_PLUGIN_ABI_VERSION_V3)) {
      error = "unsupported manifest ABI version: " + manifest.abi_version;
      return false;
    }
    const auto capabilities = value.value("capabilities", nlohmann::json::object());
    if (!capabilities.is_object() || !capabilities.contains("http") || !capabilities.contains("websocket") || !capabilities.contains("sse") || !capabilities.contains("fileStream") || !capabilities.at("http").is_boolean() || !capabilities.at("websocket").is_boolean() || !capabilities.at("sse").is_boolean() || !capabilities.at("fileStream").is_boolean()) {
      error = "manifest capabilities are invalid";
      return false;
    }
    manifest.http = capabilities.at("http").get<bool>();
    manifest.websocket = capabilities.at("websocket").get<bool>();
    manifest.sse = capabilities.at("sse").get<bool>();
    manifest.file_stream = capabilities.at("fileStream").get<bool>();
    if (!value.contains("permissions") || !value.at("permissions").is_array()) {
      error = "manifest permissions must be an array";
      return false;
    }
    const auto& permissions = value.at("permissions");
    for (const auto& permission : permissions) {
      if (!permission.is_string()) {
        error = "manifest permission must be a string";
        return false;
      }
      manifest.permissions.push_back(permission.get<std::string>());
    }
    return true;
  } catch (const nlohmann::json::exception& exception) {
    error = "invalid manifest JSON: " + std::string(exception.what());
    return false;
  }
}

PluginInfo make_info(const std::filesystem::path& path, const Manifest& manifest) {
  return {
      manifest.id,
      manifest.name,
      manifest.version,
      manifest.abi_version,
      path,
      manifest.health_path,
      manifest.permissions,
      PluginState::Discovered,
      manifest.http,
      manifest.websocket,
      manifest.sse,
      manifest.file_stream,
      std::string{},
  };
}

}  // namespace

const char* plugin_state_name(PluginState state) {
  switch (state) {
    case PluginState::Discovered:
      return "discovered";
    case PluginState::Loaded:
      return "loaded";
    case PluginState::Enabled:
      return "enabled";
    case PluginState::Disabled:
      return "disabled";
    case PluginState::Unloaded:
      return "unloaded";
    case PluginState::Failed:
      return "failed";
  }
  return "failed";
}

PluginManager::PluginManager() = default;

PluginManager::~PluginManager() {
  std::lock_guard lock(mutex_);
  for (auto& [plugin_id, runtime] : loaded_) {
    if (!runtime.host) continue;
    nlohmann::json ignored_reply;
    std::string ignored_error;
    if (runtime.started) runtime.host->request({{"op", "stop"}}, ignored_reply, ignored_error);
    runtime.host->stop();
  }
  loaded_.clear();
}

void PluginManager::set_stream_writer(StreamWriter writer) {
  std::lock_guard lock(mutex_);
  stream_writer_ = std::move(writer);
}

void PluginManager::set_stream_opener(StreamOpener opener) {
  std::lock_guard lock(mutex_);
  stream_opener_ = std::move(opener);
}

void PluginManager::set_log_writer(LogWriter writer) {
  std::lock_guard lock(mutex_);
  log_writer_ = std::move(writer);
}

void PluginManager::set_host_executable(std::filesystem::path executable) {
  std::lock_guard lock(mutex_);
  host_executable_ = std::move(executable);
}

bool PluginManager::discover(const std::filesystem::path& directory, std::string& error) {
  std::lock_guard lock(mutex_);
  plugins_.clear();
  loaded_.clear();
  if (!std::filesystem::exists(directory) || !std::filesystem::is_directory(directory)) {
    error = "plugin directory does not exist: " + directory.string();
    return false;
  }

  for (const auto& entry : std::filesystem::directory_iterator(directory)) {
    if (!entry.is_directory()) continue;
    const auto manifest_path = entry.path() / "manifest.json";
    if (!std::filesystem::is_regular_file(manifest_path)) continue;
    Manifest manifest;
    if (!read_manifest(manifest_path, manifest, error)) return false;
    std::error_code path_error;
    const auto plugin_directory = std::filesystem::weakly_canonical(entry.path(), path_error);
    const auto library = path_error ? std::filesystem::path() : std::filesystem::weakly_canonical(plugin_directory / manifest.library, path_error);
    if (path_error || !is_within_directory(plugin_directory, library) || !std::filesystem::is_regular_file(library) || !is_library(library)) {
      error = "manifest library does not exist or has an invalid extension: " + library.string();
      return false;
    }
    if (find(manifest.id)) {
      error = "duplicate plugin id: " + manifest.id;
      plugins_.clear();
      return false;
    }
    plugins_.push_back(make_info(library, manifest));
  }
  std::sort(plugins_.begin(), plugins_.end(), [](const PluginInfo& left, const PluginInfo& right) { return left.id < right.id; });
  return true;
}

std::filesystem::path PluginManager::resolve_host_executable(std::string& error) const {
  if (!host_executable_.empty()) return host_executable_;
  if (const char* value = std::getenv("PLUGMESH_PLUGIN_HOST"); value && *value) return value;
  std::filesystem::path self;
#ifdef _WIN32
  wchar_t buffer[MAX_PATH];
  if (GetModuleFileNameW(nullptr, buffer, MAX_PATH) != 0) self = buffer;
#else
  std::error_code path_error;
  self = std::filesystem::read_symlink("/proc/self/exe", path_error);
#endif
  if (self.empty()) {
    error = "cannot locate plugmesh-plugin-host; set PLUGMESH_PLUGIN_HOST";
    return {};
  }
  const auto candidate = self.parent_path() / "plugmesh-plugin-host";
  if (!std::filesystem::is_regular_file(candidate)) {
    error = "plugin host executable not found: " + candidate.string();
    return {};
  }
  return candidate;
}

bool PluginManager::load(const std::string& plugin_id, std::string& error) {
  std::lock_guard lock(mutex_);
  auto* plugin = find(plugin_id);
  if (!plugin) {
    error = "plugin not found: " + plugin_id;
    return false;
  }
  if (loaded(plugin_id)) return true;
  const auto executable = resolve_host_executable(error);
  if (executable.empty()) return set_failed(*plugin, error);
  auto host = std::make_unique<PluginHostClient>();
  const std::string id = plugin_id;
  host->set_event_handler([this, id](const nlohmann::json& event) { handle_host_event(id, event); });
  if (!host->start(executable, plugin->library, error)) return set_failed(*plugin, error);
  nlohmann::json reply;
  if (!host->request({{"op", "describe"}}, reply, error)) {
    host->stop();
    return set_failed(*plugin, error);
  }
  const auto abi_version = reply.value("abiVersion", 0u);
  const auto capabilities = reply.value("capabilities", nlohmann::json::object());
  if (plugin->abi_version != std::to_string(abi_version) || reply.value("pluginId", std::string()) != plugin->id || reply.value("name", std::string()) != plugin->name || reply.value("version", std::string()) != plugin->version ||
      (plugin->http && !capabilities.value("http", false)) || (plugin->websocket && !capabilities.value("websocket", false)) || (plugin->sse && !capabilities.value("sse", false)) || (plugin->file_stream && !capabilities.value("fileStream", false))) {
    host->stop();
    error = "manifest does not match plugin ABI: " + plugin->id;
    return set_failed(*plugin, error);
  }
  loaded_.emplace(plugin_id, LoadedPlugin{std::move(host), abi_version, false});
  plugin->state = PluginState::Loaded;
  plugin->last_error.clear();
  write_log(1, ("plugin loaded: " + plugin_id).c_str());
  return true;
}

bool PluginManager::enable(const std::string& plugin_id, std::string& error) {
  std::lock_guard lock(mutex_);
  auto* plugin = find(plugin_id);
  if (!plugin) {
    error = "plugin not found: " + plugin_id;
    return false;
  }
  if (plugin->state == PluginState::Enabled) return true;
  if (!load(plugin_id, error)) return false;
  auto* runtime = loaded(plugin_id);
  if (!runtime) {
    error = "plugin is not loaded: " + plugin_id;
    return set_failed(*plugin, error);
  }
  nlohmann::json reply;
  if (!request_plugin(plugin_id, {{"op", "start"}}, reply, error)) {
    if (plugin->state != PluginState::Failed) set_failed(*plugin, error);
    return false;
  }
  if (auto* current = loaded(plugin_id)) current->started = true;
  plugin->state = PluginState::Enabled;
  plugin->last_error.clear();
  write_log(1, ("plugin enabled: " + plugin_id).c_str());
  return true;
}

bool PluginManager::disable(const std::string& plugin_id, std::string& error) {
  std::lock_guard lock(mutex_);
  auto* plugin = find(plugin_id);
  auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->host) {
    error = "plugin is not loaded: " + plugin_id;
    return false;
  }
  if (plugin->state != PluginState::Enabled) {
    plugin->state = PluginState::Disabled;
    return true;
  }
  nlohmann::json reply;
  if (!request_plugin(plugin_id, {{"op", "stop"}}, reply, error)) {
    if (plugin->state != PluginState::Failed) set_failed(*plugin, error);
    return false;
  }
  if (auto* current = loaded(plugin_id)) current->started = false;
  plugin->state = PluginState::Disabled;
  write_log(1, ("plugin disabled: " + plugin_id).c_str());
  return true;
}

bool PluginManager::unload(const std::string& plugin_id, std::string& error) {
  std::lock_guard lock(mutex_);
  auto* plugin = find(plugin_id);
  auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->host) {
    error = "plugin is not loaded: " + plugin_id;
    return false;
  }
  if (runtime->started) {
    nlohmann::json reply;
    std::string ignored;
    runtime->host->request({{"op", "stop"}}, reply, ignored);
  }
  runtime->host->stop();
  loaded_.erase(plugin_id);
  plugin->state = PluginState::Unloaded;
  plugin->last_error.clear();
  write_log(1, ("plugin unloaded: " + plugin_id).c_str());
  return true;
}

bool PluginManager::reload(const std::string& plugin_id, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* existing = find(plugin_id);
  const bool was_enabled = existing && existing->state == PluginState::Enabled;
  const bool was_disabled = existing && existing->state == PluginState::Disabled;
  if (loaded(plugin_id) && !unload(plugin_id, error)) return false;
  if (!load(plugin_id, error)) return false;
  if (was_enabled) return enable(plugin_id, error);
  if (was_disabled) find(plugin_id)->state = PluginState::Disabled;
  return true;
}

bool PluginManager::request_plugin(const std::string& plugin_id, const nlohmann::json& operation, nlohmann::json& reply, std::string& error) {
  auto* runtime = loaded(plugin_id);
  if (!runtime || !runtime->host) {
    error = "plugin is not loaded: " + plugin_id;
    return false;
  }
  if (!runtime->host->request(operation, reply, error)) {
    if (!runtime->host->alive()) fail_runtime(plugin_id, error);
    return false;
  }
  return true;
}

void PluginManager::handle_host_event(const std::string&, const nlohmann::json& event) {
  const auto name = event.value("event", std::string());
  if (name == "log") {
    const auto message = event.value("message", std::string());
    write_log(event.value("level", 1), message.c_str());
    return;
  }
  const auto stream_id = event.value("streamId", std::string());
  if (stream_id.empty()) return;
  if (name == "stream.open") {
    const auto headers = event.value("headersJson", std::string("{}"));
    if (stream_opener_) stream_opener_(stream_id.c_str(), static_cast<uint16_t>(event.value("status", 0)), headers.c_str());
    return;
  }
  if (name == "stream.write") {
    std::string data;
    std::string decode_error;
    if (!base64_decode(event.value("data", std::string()), data, decode_error)) {
      write_log(2, ("plugin stream payload is invalid: " + stream_id).c_str());
      return;
    }
    if (stream_writer_) stream_writer_(stream_id.c_str(), reinterpret_cast<const uint8_t*>(data.data()), data.size(), event.value("finished", 0));
  }
}

void PluginManager::fail_runtime(const std::string& plugin_id, const std::string& message) {
  if (auto iterator = loaded_.find(plugin_id); iterator != loaded_.end()) {
    if (iterator->second.host) iterator->second.host->stop();
    loaded_.erase(iterator);
  }
  if (auto* plugin = find(plugin_id)) {
    plugin->state = PluginState::Failed;
    plugin->last_error = message;
  }
}

namespace {

nlohmann::json request_payload(const plugmesh_http_request& request) {
  return {
      {"method", request.method ? request.method : ""},
      {"path", request.path ? request.path : ""},
      {"headersJson", request.headers_json ? request.headers_json : "{}"},
      {"body", request.body ? base64_encode(request.body, request.body_size) : std::string()},
  };
}

void fill_response(const nlohmann::json& reply, plugmesh_http_response& response) {
  // 调用方在返回后立即消费响应，thread_local 缓冲保证指针在本次调用期间有效。
  thread_local std::string headers;
  thread_local std::string body;
  const auto& payload = reply.value("response", nlohmann::json::object());
  headers = payload.value("headersJson", std::string("{}"));
  std::string decode_error;
  if (!base64_decode(payload.value("body", std::string()), body, decode_error)) body.clear();
  response.status = static_cast<uint16_t>(payload.value("status", 0));
  response.headers_json = headers.c_str();
  response.body = {reinterpret_cast<const uint8_t*>(body.data()), body.size()};
}

}  // namespace

bool PluginManager::health(const std::string& plugin_id, plugmesh_http_response& response, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  if (!plugin || plugin->state != PluginState::Enabled) {
    error = "plugin is not enabled: " + plugin_id;
    return false;
  }
  nlohmann::json reply;
  if (!request_plugin(plugin_id, {{"op", "health"}}, reply, error)) return false;
  if (!reply.contains("response")) {
    error = "plugin health check failed: " + plugin_id;
    return false;
  }
  fill_response(reply, response);
  return true;
}

bool PluginManager::http(const std::string& plugin_id, const plugmesh_http_request& request, plugmesh_http_response& response, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  if (!plugin || !plugin->http || plugin->state != PluginState::Enabled) {
    error = "plugin is not enabled: " + plugin_id;
    return false;
  }
  nlohmann::json reply;
  if (!request_plugin(plugin_id, {{"op", "http"}, {"request", request_payload(request)}}, reply, error)) return false;
  if (!reply.contains("response")) {
    error = "plugin HTTP handler failed: " + plugin_id;
    return false;
  }
  fill_response(reply, response);
  return true;
}

bool PluginManager::sse(const std::string& plugin_id, const std::string& stream_id, const plugmesh_http_request& request, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  if (!plugin || !plugin->sse || plugin->state != PluginState::Enabled) {
    error = "plugin SSE handler is unavailable: " + plugin_id;
    return false;
  }
  nlohmann::json reply;
  return request_plugin(plugin_id, {{"op", "sse"}, {"streamId", stream_id}, {"request", request_payload(request)}}, reply, error);
}

bool PluginManager::file_stream(const std::string& plugin_id, const std::string& stream_id, const plugmesh_http_request& request, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  if (!plugin || !plugin->file_stream || plugin->state != PluginState::Enabled) {
    error = "plugin file stream handler is unavailable: " + plugin_id;
    return false;
  }
  nlohmann::json reply;
  return request_plugin(plugin_id, {{"op", "file"}, {"streamId", stream_id}, {"request", request_payload(request)}}, reply, error);
}

bool PluginManager::websocket_open(const std::string& plugin_id, const std::string& connection_id, const std::string& path, const std::string& headers_json, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  const auto* runtime = loaded(plugin_id);
  if (!plugin || !plugin->websocket || !runtime || plugin->state != PluginState::Enabled) {
    error = "plugin WebSocket handler is unavailable: " + plugin_id;
    return false;
  }
  if (runtime->abi_version < 3) return true;
  nlohmann::json reply;
  return request_plugin(plugin_id, {{"op", "websocket.open"}, {"connectionId", connection_id}, {"path", path}, {"headersJson", headers_json}}, reply, error);
}

bool PluginManager::websocket(const std::string& plugin_id, const std::string& connection_id, const uint8_t* data, uint64_t size, bool is_text, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  if (!plugin || !plugin->websocket || plugin->state != PluginState::Enabled) {
    error = "plugin WebSocket handler is unavailable: " + plugin_id;
    return false;
  }
  nlohmann::json reply;
  return request_plugin(plugin_id, {{"op", "websocket.data"}, {"connectionId", connection_id}, {"data", data ? base64_encode(data, size) : std::string()}, {"text", is_text}}, reply, error);
}

bool PluginManager::websocket_close(const std::string& plugin_id, const std::string& connection_id, uint16_t code, const std::string& reason, std::string& error) {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  const auto* runtime = loaded(plugin_id);
  if (!plugin || !plugin->websocket || !runtime || plugin->state != PluginState::Enabled) {
    error = "plugin WebSocket handler is unavailable: " + plugin_id;
    return false;
  }
  if (runtime->abi_version < 3) return true;
  nlohmann::json reply;
  return request_plugin(plugin_id, {{"op", "websocket.close"}, {"connectionId", connection_id}, {"code", code}, {"reason", reason}}, reply, error);
}

std::vector<PluginInfo> PluginManager::snapshot() const {
  std::lock_guard lock(mutex_);
  return plugins_;
}

std::optional<PluginInfo> PluginManager::info_snapshot(const std::string& plugin_id) const {
  std::lock_guard lock(mutex_);
  const auto* plugin = find(plugin_id);
  return plugin ? std::optional<PluginInfo>(*plugin) : std::nullopt;
}

PluginInfo* PluginManager::find(const std::string& plugin_id) {
  const auto iterator = std::find_if(plugins_.begin(), plugins_.end(), [&](const PluginInfo& plugin) { return plugin.id == plugin_id; });
  return iterator == plugins_.end() ? nullptr : &*iterator;
}

const PluginInfo* PluginManager::find(const std::string& plugin_id) const {
  const auto iterator = std::find_if(plugins_.begin(), plugins_.end(), [&](const PluginInfo& plugin) { return plugin.id == plugin_id; });
  return iterator == plugins_.end() ? nullptr : &*iterator;
}

PluginManager::LoadedPlugin* PluginManager::loaded(const std::string& plugin_id) {
  const auto iterator = loaded_.find(plugin_id);
  return iterator == loaded_.end() ? nullptr : &iterator->second;
}

const PluginManager::LoadedPlugin* PluginManager::loaded(const std::string& plugin_id) const {
  const auto iterator = loaded_.find(plugin_id);
  return iterator == loaded_.end() ? nullptr : &iterator->second;
}

bool PluginManager::set_failed(PluginInfo& plugin, std::string& error) {
  plugin.state = PluginState::Failed;
  plugin.last_error = error;
  return false;
}

void PluginManager::write_log(int level, const char* message) {
  std::lock_guard lock(mutex_);
  if (log_writer_ && message) log_writer_(level, message);
}

}  // namespace plugmesh
