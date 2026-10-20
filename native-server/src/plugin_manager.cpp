#include "plugmesh/plugin_manager.h"

#include "plugmesh/plugin_loader.h"

#include <algorithm>
#include <fstream>

#include <nlohmann/json.hpp>

namespace plugmesh {

namespace {

bool is_library(const std::filesystem::path& path) {
#ifdef _WIN32
  return path.extension() == ".dll";
#else
  return path.extension() == ".so";
#endif
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
    if (manifest.abi_version != std::to_string(PLUGMESH_PLUGIN_ABI_VERSION)) {
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

PluginInfo make_info(const std::filesystem::path& path, const Manifest& manifest, const plugmesh_plugin_api_v1& api) {
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

PluginManager::PluginManager(plugmesh_host_api host_api) : host_api_(host_api) {
  if (host_api_.abi_version == 0) host_api_.abi_version = PLUGMESH_PLUGIN_ABI_VERSION;
}

PluginManager::~PluginManager() {
  for (auto& [plugin_id, loaded_plugin] : loaded_) {
    const auto* plugin = find(plugin_id);
    if (plugin && plugin->state == PluginState::Enabled && loaded_plugin.loader && loaded_plugin.loader->loaded() && loaded_plugin.loader->api()->stop) loaded_plugin.loader->api()->stop();
  }
  loaded_.clear();
}

bool PluginManager::discover(const std::filesystem::path& directory, std::string& error) {
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
    const auto library = entry.path() / manifest.library;
    if (!std::filesystem::is_regular_file(library) || !is_library(library)) {
      error = "manifest library does not exist or has an invalid extension: " + library.string();
      return false;
    }
    PluginLoader loader;
    if (!loader.load(library, error)) return false;
    const auto* api = loader.api();
    if (!api->plugin_id || !api->plugin_name || !api->plugin_version || manifest.id != api->plugin_id || manifest.name != api->plugin_name || manifest.version != api->plugin_version || (manifest.http && !api->handle_http) || (manifest.websocket && !api->handle_websocket) || (manifest.sse && !api->handle_sse) || manifest.file_stream) {
      error = "manifest does not match plugin ABI: " + manifest.id;
      return false;
    }
    if (find(manifest.id)) {
      error = "duplicate plugin id: " + manifest.id;
      plugins_.clear();
      return false;
    }
    plugins_.push_back(make_info(library, manifest, *api));
  }
  std::sort(plugins_.begin(), plugins_.end(), [](const PluginInfo& left, const PluginInfo& right) { return left.id < right.id; });
  return true;
}

bool PluginManager::load(const std::string& plugin_id, std::string& error) {
  auto* plugin = find(plugin_id);
  if (!plugin) {
    error = "plugin not found: " + plugin_id;
    return false;
  }
  if (loaded(plugin_id)) return true;
  auto loader = std::make_unique<PluginLoader>();
  if (!loader->load(plugin->library, error)) return set_failed(*plugin, error);
  loaded_.emplace(plugin_id, LoadedPlugin{std::move(loader)});
  plugin->state = PluginState::Loaded;
  return true;
}

bool PluginManager::enable(const std::string& plugin_id, std::string& error) {
  auto* plugin = find(plugin_id);
  if (!plugin) {
    error = "plugin not found: " + plugin_id;
    return false;
  }
  if (plugin->state == PluginState::Enabled) return true;
  if (!load(plugin_id, error)) return false;
  auto* runtime = loaded(plugin_id);
  if (!runtime || !runtime->loader || runtime->loader->api()->start(&host_api_) != 0) return set_failed(*plugin, error = "plugin start failed: " + plugin_id);
  plugin->state = PluginState::Enabled;
  return true;
}

bool PluginManager::disable(const std::string& plugin_id, std::string& error) {
  auto* plugin = find(plugin_id);
  auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->loader) {
    error = "plugin is not loaded: " + plugin_id;
    return false;
  }
  if (plugin->state != PluginState::Enabled) {
    plugin->state = PluginState::Disabled;
    return true;
  }
  if (runtime->loader->api()->stop() != 0) return set_failed(*plugin, error = "plugin stop failed: " + plugin_id);
  plugin->state = PluginState::Disabled;
  return true;
}

bool PluginManager::unload(const std::string& plugin_id, std::string& error) {
  auto* plugin = find(plugin_id);
  auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->loader) {
    error = "plugin is not loaded: " + plugin_id;
    return false;
  }
  if (plugin->state == PluginState::Enabled && runtime->loader->api()->stop() != 0) return set_failed(*plugin, error = "plugin stop failed: " + plugin_id);
  loaded_.erase(plugin_id);
  plugin->state = PluginState::Unloaded;
  return true;
}

bool PluginManager::reload(const std::string& plugin_id, std::string& error) {
  const auto* existing = find(plugin_id);
  const bool was_enabled = existing && existing->state == PluginState::Enabled;
  if (loaded(plugin_id) && !unload(plugin_id, error)) return false;
  if (!load(plugin_id, error)) return false;
  return !was_enabled || enable(plugin_id, error);
}

bool PluginManager::health(const std::string& plugin_id, plugmesh_http_response& response, std::string& error) const {
  const auto* plugin = find(plugin_id);
  const auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->loader || plugin->state != PluginState::Enabled) {
    error = "plugin is not enabled: " + plugin_id;
    return false;
  }
  if (runtime->loader->api()->health(&response) != 0) {
    error = "plugin health check failed: " + plugin_id;
    return false;
  }
  return true;
}

bool PluginManager::http(const std::string& plugin_id, const plugmesh_http_request& request, plugmesh_http_response& response, std::string& error) const {
  const auto* plugin = find(plugin_id);
  const auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->loader || plugin->state != PluginState::Enabled || !runtime->loader->api()->handle_http) {
    error = "plugin is not enabled: " + plugin_id;
    return false;
  }
  if (runtime->loader->api()->handle_http(&request, &response) != 0) {
    error = "plugin HTTP handler failed: " + plugin_id;
    return false;
  }
  return true;
}

bool PluginManager::websocket(const std::string& plugin_id, const std::string& connection_id, const uint8_t* data, uint64_t size, bool is_text, std::string& error) const {
  const auto* plugin = find(plugin_id);
  const auto* runtime = loaded(plugin_id);
  if (!plugin || !runtime || !runtime->loader || plugin->state != PluginState::Enabled || !runtime->loader->api()->handle_websocket) {
    error = "plugin WebSocket handler is unavailable: " + plugin_id;
    return false;
  }
  if (runtime->loader->api()->handle_websocket(connection_id.c_str(), data, size, is_text ? 1 : 0) != 0) {
    error = "plugin WebSocket handler failed: " + plugin_id;
    return false;
  }
  return true;
}

const PluginInfo* PluginManager::info(const std::string& plugin_id) const { return find(plugin_id); }

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
  return false;
}

}  // namespace plugmesh
