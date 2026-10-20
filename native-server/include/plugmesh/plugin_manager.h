#pragma once

#include "plugmesh/plugin_api.h"

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
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
  std::string abi_version;
  std::filesystem::path library;
  std::string health_path;
  std::vector<std::string> permissions;
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
  using StreamWriter = std::function<int(const char*, const uint8_t*, uint64_t, int)>;
  using StreamOpener = std::function<int(const char*, uint16_t, const char*)>;

  explicit PluginManager(plugmesh_host_api host_api = {});
  PluginManager(const PluginManager&) = delete;
  PluginManager& operator=(const PluginManager&) = delete;
  ~PluginManager();

  void set_stream_writer(StreamWriter writer);
  void set_stream_opener(StreamOpener opener);

  bool discover(const std::filesystem::path& directory, std::string& error);
  std::vector<PluginInfo> snapshot() const;
  std::optional<PluginInfo> info_snapshot(const std::string& plugin_id) const;
  bool load(const std::string& plugin_id, std::string& error);
  bool enable(const std::string& plugin_id, std::string& error);
  bool disable(const std::string& plugin_id, std::string& error);
  bool unload(const std::string& plugin_id, std::string& error);
  bool reload(const std::string& plugin_id, std::string& error);
  bool health(const std::string& plugin_id, plugmesh_http_response& response, std::string& error) const;
  bool http(const std::string& plugin_id, const plugmesh_http_request& request, plugmesh_http_response& response, std::string& error) const;
  bool sse(const std::string& plugin_id, const std::string& stream_id, const plugmesh_http_request& request, std::string& error) const;
  bool file_stream(const std::string& plugin_id, const std::string& stream_id, const plugmesh_http_request& request, std::string& error) const;
  bool websocket(const std::string& plugin_id, const std::string& connection_id, const uint8_t* data, uint64_t size, bool is_text, std::string& error) const;

 private:
  struct LoadedPlugin {
    std::unique_ptr<PluginLoader> loader;
  };

  PluginInfo* find(const std::string& plugin_id);
  const PluginInfo* find(const std::string& plugin_id) const;
  LoadedPlugin* loaded(const std::string& plugin_id);
  const LoadedPlugin* loaded(const std::string& plugin_id) const;
  bool set_failed(PluginInfo& plugin, std::string& error);
  static int stream_write_trampoline(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
  int write_stream(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
  static int stream_open_trampoline(const char* stream_id, uint16_t status, const char* headers_json);
  int open_stream(const char* stream_id, uint16_t status, const char* headers_json);

  plugmesh_host_api host_api_{};
  mutable std::recursive_mutex mutex_;
  StreamOpener stream_opener_;
  StreamWriter stream_writer_;
  static PluginManager* active_instance_;
  std::vector<PluginInfo> plugins_;
  std::map<std::string, LoadedPlugin> loaded_;
};

}  // namespace plugmesh
