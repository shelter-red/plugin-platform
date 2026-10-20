#pragma once

#include "plugmesh/plugin_api.h"

#include <filesystem>
#include <map>
#include <memory>
#include <string>
#include <vector>

namespace plugmesh {

enum class PluginState {
  Discovered,
  Loaded,
  Enabled,
  Disabled,
  Unloaded,
  Failed,
};

struct PluginInfo {
  std::string id;
  std::string name;
  std::string version;
  std::filesystem::path library;
  PluginState state = PluginState::Discovered;
  bool http = false;
  bool websocket = false;
  bool sse = false;
  bool file_stream = false;
};

const char* plugin_state_name(PluginState state);

class PluginLoader;

class PluginManager {
 public:
  explicit PluginManager(plugmesh_host_api host_api = {});
  PluginManager(const PluginManager&) = delete;
  PluginManager& operator=(const PluginManager&) = delete;
  ~PluginManager();

  bool discover(const std::filesystem::path& directory, std::string& error);
  const std::vector<PluginInfo>& plugins() const { return plugins_; }
  bool load(const std::string& plugin_id, std::string& error);
  bool enable(const std::string& plugin_id, std::string& error);
  bool disable(const std::string& plugin_id, std::string& error);
  bool unload(const std::string& plugin_id, std::string& error);
  bool reload(const std::string& plugin_id, std::string& error);
  bool health(const std::string& plugin_id, plugmesh_http_response& response, std::string& error) const;

 private:
  struct LoadedPlugin {
    std::unique_ptr<PluginLoader> loader;
  };

  PluginInfo* find(const std::string& plugin_id);
  const PluginInfo* find(const std::string& plugin_id) const;
  LoadedPlugin* loaded(const std::string& plugin_id);
  const LoadedPlugin* loaded(const std::string& plugin_id) const;
  bool set_failed(PluginInfo& plugin, std::string& error);

  plugmesh_host_api host_api_{};
  std::vector<PluginInfo> plugins_;
  std::map<std::string, LoadedPlugin> loaded_;
};

}  // namespace plugmesh
