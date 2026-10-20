#include "plugmesh/plugin_manager.h"

#include "plugmesh/plugin_loader.h"

#include <algorithm>

namespace plugmesh {

namespace {

bool is_library(const std::filesystem::path& path) {
#ifdef _WIN32
  return path.extension() == ".dll";
#else
  return path.extension() == ".so";
#endif
}

PluginInfo make_info(const std::filesystem::path& path, const plugmesh_plugin_api_v1& api) {
  return {
      api.plugin_id ? api.plugin_id : "",
      api.plugin_name ? api.plugin_name : "",
      api.plugin_version ? api.plugin_version : "",
      path,
      PluginState::Discovered,
      api.handle_http != nullptr,
      api.handle_websocket != nullptr,
      api.handle_sse != nullptr,
      false,
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
    if (!entry.is_regular_file() || !is_library(entry.path())) continue;
    PluginLoader loader;
    if (!loader.load(entry.path(), error)) continue;
    const auto* api = loader.api();
    if (!api->plugin_id || !api->plugin_name || !api->plugin_version) continue;
    if (find(api->plugin_id)) {
      error = "duplicate plugin id: " + std::string(api->plugin_id);
      plugins_.clear();
      return false;
    }
    plugins_.push_back(make_info(entry.path(), *api));
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
