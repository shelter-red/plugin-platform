#pragma once

#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

// 以子进程方式承载单个插件的动态库。插件崩溃只会终止子进程，父服务器通过
// 管道读写逐行 JSON 协议，并在下一次调用时报告插件已失效。
class PluginHostClient {
 public:
  using EventHandler = std::function<void(const nlohmann::json&)>;

  PluginHostClient() = default;
  PluginHostClient(const PluginHostClient&) = delete;
  PluginHostClient& operator=(const PluginHostClient&) = delete;
  ~PluginHostClient();

  bool start(const std::filesystem::path& executable, const std::filesystem::path& library, std::string& error);
  bool request(const nlohmann::json& operation, nlohmann::json& response, std::string& error);
  bool alive();
  void set_event_handler(EventHandler handler);
  void stop();

 private:
  bool write_line(const std::string& line, std::string& error);
  bool read_line(std::string& line, std::string& error);

  bool running_ = false;
  uint64_t next_id_ = 1;
  std::string read_buffer_;
  EventHandler event_handler_;
#ifdef _WIN32
  void* process_ = nullptr;
  void* stdin_handle_ = nullptr;
  void* stdout_handle_ = nullptr;
#else
  int stdin_fd_ = -1;
  int stdout_fd_ = -1;
  int pid_ = -1;
#endif
};

}  // namespace plugmesh
