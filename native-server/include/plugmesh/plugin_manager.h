#pragma once

#include "plugmesh/plugin_api.h"

#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <set>
#include <string>
#include <vector>

#include <nlohmann/json.hpp>

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
  bool websocket_open = false;
  bool websocket_close = false;
  bool sse_cancel = false;
  std::string last_error;
};

const char* plugin_state_name(PluginState state);

class PluginHostClient;

class PluginManager {
 public:
  using StreamWriter = std::function<int(const char*, const uint8_t*, uint64_t, int)>;
  using StreamOpener = std::function<int(const char*, uint16_t, const char*)>;
  using LogWriter = std::function<void(int, const char*)>;

  PluginManager();
  PluginManager(const PluginManager&) = delete;
  PluginManager& operator=(const PluginManager&) = delete;
  ~PluginManager();

  void set_stream_writer(StreamWriter writer);
  void set_stream_opener(StreamOpener opener);
  void set_log_writer(LogWriter writer);
  // 未显式设置时按 PLUGMESH_PLUGIN_HOST 环境变量或服务器同目录查找宿主进程。
  void set_host_executable(std::filesystem::path executable);

  bool discover(const std::filesystem::path& directory, std::string& error);
  std::vector<PluginInfo> snapshot() const;
  std::optional<PluginInfo> info_snapshot(const std::string& plugin_id) const;
  bool load(const std::string& plugin_id, std::string& error);
  bool enable(const std::string& plugin_id, std::string& error);
  bool disable(const std::string& plugin_id, std::string& error);
  bool unload(const std::string& plugin_id, std::string& error);
  bool reload(const std::string& plugin_id, std::string& error);
  bool health(const std::string& plugin_id, plugmesh_http_response& response, std::string& error);
  bool http(const std::string& plugin_id, const plugmesh_http_request& request, plugmesh_http_response& response, std::string& error);
  bool sse(const std::string& plugin_id, const std::string& stream_id, const plugmesh_http_request& request, std::string& error);
  bool cancel_sse(const std::string& plugin_id, const std::string& stream_id, const std::string& reason, std::string& error);
  bool file_stream(const std::string& plugin_id, const std::string& stream_id, const plugmesh_http_request& request, std::string& error);
  bool websocket_open(const std::string& plugin_id, const std::string& connection_id, const std::string& path, const std::string& headers_json, std::string& error);
  bool websocket(const std::string& plugin_id, const std::string& connection_id, const uint8_t* data, uint64_t size, bool is_text, std::string& error);
  bool websocket_close(const std::string& plugin_id, const std::string& connection_id, uint16_t code, const std::string& reason, std::string& error);

 private:
  struct LoadedPlugin {
    std::unique_ptr<PluginHostClient> host;
    bool started = false;
    std::set<std::string> active_sse_streams;
  };

  PluginInfo* find(const std::string& plugin_id);
  const PluginInfo* find(const std::string& plugin_id) const;
  std::shared_ptr<LoadedPlugin> loaded(const std::string& plugin_id) const;
  bool set_failed(PluginInfo& plugin, std::string& error);
  std::filesystem::path resolve_host_executable(std::string& error) const;
  bool request_plugin(const std::string& plugin_id, const nlohmann::json& operation, nlohmann::json& reply, std::string& error);
  void handle_host_event(const std::string& plugin_id, const nlohmann::json& event);
  void fail_runtime(const std::string& plugin_id, const std::string& message);
  void write_log(int level, const char* message);

  mutable std::recursive_mutex mutex_;
  mutable std::mutex callback_mutex_;
  StreamOpener stream_opener_;
  StreamWriter stream_writer_;
  LogWriter log_writer_;
  std::filesystem::path host_executable_;
  std::vector<PluginInfo> plugins_;
  std::map<std::string, std::shared_ptr<LoadedPlugin>> loaded_;
};

}  // namespace plugmesh
