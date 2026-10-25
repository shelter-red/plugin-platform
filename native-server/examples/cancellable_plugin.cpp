#include "plugmesh/plugin_api.h"

#include <atomic>
#include <chrono>
#include <cstring>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>

namespace {

const plugmesh_host_api* host = nullptr;
std::mutex streams_mutex;
std::unordered_map<std::string, std::shared_ptr<std::atomic_bool>> streams;

int start_plugin(const plugmesh_host_api* next_host) {
  host = next_host;
  return 0;
}

int stop_plugin() {
  std::lock_guard lock(streams_mutex);
  for (auto& [stream_id, cancelled] : streams) {
    (void)stream_id;
    cancelled->store(true, std::memory_order_release);
  }
  streams.clear();
  host = nullptr;
  return 0;
}

int health_plugin(plugmesh_http_response* response) {
  static const uint8_t body[] = "ok";
  response->status = 200;
  response->headers_json = "{}";
  response->body = {body, sizeof(body) - 1};
  return 0;
}

int handle_http(const plugmesh_http_request*, plugmesh_http_response* response) { return health_plugin(response); }

int handle_websocket(const char* connection_id, const uint8_t* data, uint64_t size, int) {
  return host && host->stream_write ? host->stream_write(connection_id, data, size, 0) : -1;
}

int handle_websocket_open(const char*, const char*, const char*) { return 0; }

int handle_websocket_close(const char*, uint16_t, const char*) { return 0; }

int handle_sse(const char* stream_id, const plugmesh_http_request* request) {
  if (!host || !host->stream_write || !stream_id) return -1;
  if (!request || !request->path || std::strcmp(request->path, "/cancel-events") != 0) {
    static const uint8_t event[] = "data: cancellable-plugin\n\n";
    return host->stream_write(stream_id, event, sizeof(event) - 1, 1);
  }

  auto cancelled = std::make_shared<std::atomic_bool>(false);
  {
    std::lock_guard lock(streams_mutex);
    streams[stream_id] = cancelled;
  }
  if (host->log) host->log(1, (std::string("sse.started:") + stream_id).c_str());

  // 先发一条启动事件：调用方收到它就能确定流已经建立、取消回调一定可达，
  // 不必靠“等一小段时间”来猜插件有没有跑起来。
  static const uint8_t started_event[] = "data: started\n\n";
  if (host->stream_write(stream_id, started_event, sizeof(started_event) - 1, 0) != 0) {
    std::lock_guard lock(streams_mutex);
    streams.erase(stream_id);
    return -1;
  }

  // 模拟长时间运行的计算或数据源。取消回调只负责通知插件，插件必须
  // 自行让 handle_sse 尽快观察到取消并返回；宿主不会强行中止插件线程。
  for (int attempt = 0; attempt < 1000 && !cancelled->load(std::memory_order_acquire); ++attempt) {
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }

  {
    std::lock_guard lock(streams_mutex);
    streams.erase(stream_id);
  }
  const bool was_cancelled = cancelled->load(std::memory_order_acquire);
  static const uint8_t cancelled_event[] = "data: cancelled\n\n";
  static const uint8_t timeout_event[] = "data: timed-out\n\n";
  const auto* data = was_cancelled ? cancelled_event : timeout_event;
  const auto size = was_cancelled ? sizeof(cancelled_event) - 1 : sizeof(timeout_event) - 1;
  return host->stream_write(stream_id, data, size, 1);
}

int handle_sse_cancel(const char* stream_id) {
  if (!stream_id) return -1;
  std::shared_ptr<std::atomic_bool> cancelled;
  {
    std::lock_guard lock(streams_mutex);
    const auto iterator = streams.find(stream_id);
    if (iterator != streams.end()) cancelled = iterator->second;
  }
  if (!cancelled) return -1;
  cancelled->store(true, std::memory_order_release);
  if (host && host->log) host->log(1, (std::string("sse.cancelled:") + stream_id).c_str());
  return 0;
}

int handle_file(const char* stream_id, const plugmesh_http_request*) {
  if (!host || !host->stream_open || !host->stream_write) return -1;
  static const uint8_t body[] = "cancellable-file";
  if (host->stream_open(stream_id, 200, "{\"content-type\":\"application/octet-stream\"}") != 0) return -1;
  return host->stream_write(stream_id, body, sizeof(body) - 1, 1);
}

const plugmesh_plugin_api API = {
    PLUGMESH_PLUGIN_ABI_VERSION, "cancellable.plugin", "Cancellable Plugin", "0.1.0", start_plugin, stop_plugin, health_plugin, handle_http,
    handle_websocket_open,
    handle_websocket,
    handle_websocket_close,
    handle_sse,
    handle_sse_cancel,
    handle_file,
};

}  // namespace

extern "C" PLUGMESH_EXPORT const plugmesh_plugin_api* plugmesh_plugin_get_api() {
  return &API;
}
