#pragma once

#include <atomic>
#include <condition_variable>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_set>

#include <nlohmann/json.hpp>

namespace plugmesh {

// 以子进程方式承载单个插件的动态库。插件崩溃只会终止子进程，父服务器通过
// 管道读写逐行 JSON 协议。独立读取线程支持一个 SSE 请求阻塞时并发发送取消帧。
class PluginHostClient {
 public:
  using EventHandler = std::function<void(const nlohmann::json&)>;

  PluginHostClient() = default;
  PluginHostClient(const PluginHostClient&) = delete;
  PluginHostClient& operator=(const PluginHostClient&) = delete;
  ~PluginHostClient();

  bool start(const std::filesystem::path& executable, const std::filesystem::path& library, std::string& error);
  bool request(const nlohmann::json& operation, nlohmann::json& response, std::string& error);
  // 发送不等待最终响应的控制帧，供 SSE 取消等必须绕过阻塞请求的场景使用。
  bool cancel_sse(const std::string& stream_id, const std::string& reason, std::string& error);
  bool alive();
  void set_event_handler(EventHandler handler);
  void stop();

 private:
  struct PendingResponse {
    bool done = false;
    bool ok = false;
    nlohmann::json response = nlohmann::json::object();
    std::string error;
  };

  bool write_line(const std::string& line, std::string& error);
  bool read_line(std::string& line, std::string& error);
  bool send_without_reply(const nlohmann::json& operation, std::string& error);
  void reader_loop();
  void finish_pending(uint64_t id, bool ok, nlohmann::json response, std::string error);
  void fail_all_pending(const std::string& error);
  void close_stdin();

  std::mutex lifecycle_mutex_;
  std::mutex write_mutex_;
  std::mutex pending_mutex_;
  std::condition_variable pending_cv_;
  std::map<uint64_t, PendingResponse> pending_;
  std::unordered_set<uint64_t> ignored_responses_;
  std::thread reader_;
  std::atomic<bool> running_{false};
  std::atomic<uint64_t> next_id_{1};
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
