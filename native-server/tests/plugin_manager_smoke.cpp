#include "plugmesh/plugin_manager.h"

#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

struct Recorder {
  void wait_for_log(const std::string& message) {
    std::unique_lock lock(mutex);
    condition.wait_for(lock, std::chrono::seconds(3), [&] {
      for (const auto& entry : logs) {
        if (entry == message) return true;
      }
      return false;
    });
  }

  bool has_log(const std::string& message) {
    std::lock_guard lock(mutex);
    for (const auto& entry : logs) {
      if (entry == message) return true;
    }
    return false;
  }

  std::string stream(const std::string& id) {
    std::lock_guard lock(mutex);
    const auto iterator = streams.find(id);
    return iterator == streams.end() ? std::string() : iterator->second;
  }

  bool finished(const std::string& id) {
    std::lock_guard lock(mutex);
    const auto iterator = finished_streams.find(id);
    return iterator != finished_streams.end() && iterator->second;
  }

  uint16_t opened_status(const std::string& id) {
    std::lock_guard lock(mutex);
    const auto iterator = opened_statuses.find(id);
    return iterator == opened_statuses.end() ? 0 : iterator->second;
  }

  std::string opened_headers(const std::string& id) {
    std::lock_guard lock(mutex);
    const auto iterator = opened_headers_map.find(id);
    return iterator == opened_headers_map.end() ? std::string() : iterator->second;
  }

  std::mutex mutex;
  std::condition_variable condition;
  std::map<std::string, std::string> streams;
  std::map<std::string, bool> finished_streams;
  std::map<std::string, uint16_t> opened_statuses;
  std::map<std::string, std::string> opened_headers_map;
  std::vector<std::string> logs;
};

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: plugmesh-plugin-manager-smoke <plugin-host> <plugin-directory>\n";
    return 2;
  }
  plugmesh::PluginManager manager;
  manager.set_host_executable(argv[1]);
  Recorder recorder;
  manager.set_stream_opener([&](const char* id, uint16_t status, const char* headers) {
    std::lock_guard lock(recorder.mutex);
    const std::string stream_id = id ? id : "";
    recorder.opened_statuses[stream_id] = status;
    recorder.opened_headers_map[stream_id] = headers ? headers : "";
    return 0;
  });
  manager.set_log_writer([&](int, const char* message) {
    if (!message) return;
    {
      std::lock_guard lock(recorder.mutex);
      recorder.logs.emplace_back(message);
    }
    recorder.condition.notify_all();
  });
  manager.set_stream_writer([&](const char* id, const uint8_t* data, uint64_t size, int is_finished) {
    std::lock_guard lock(recorder.mutex);
    const std::string stream_id = id ? id : "";
    recorder.streams[stream_id] = data && size > 0 ? std::string(reinterpret_cast<const char*>(data), static_cast<size_t>(size)) : std::string();
    recorder.finished_streams[stream_id] = is_finished != 0;
    return 0;
  });

  std::string error;
  if (!manager.discover(std::filesystem::path(argv[2]), error)) {
    std::cerr << "discovery failed: " << error << '\n';
    return 1;
  }
  const auto sample = manager.info_snapshot("sample.plugin");
  const auto cancellable = manager.info_snapshot("cancellable.plugin");
  if (!sample || sample->health_path != "/health" || !cancellable || cancellable->abi_version != "4") {
    std::cerr << "sample or cancellable plugin was not discovered\n";
    return 1;
  }
  if (!manager.load("sample.plugin", error) || manager.info_snapshot("sample.plugin")->state != plugmesh::PluginState::Loaded) {
    std::cerr << "load failed: " << error << '\n';
    return 1;
  }
  if (!recorder.has_log("plugin loaded: sample.plugin")) {
    std::cerr << "plugin log callback failed\n";
    return 1;
  }
  if (!manager.enable("sample.plugin", error) || manager.info_snapshot("sample.plugin")->state != plugmesh::PluginState::Enabled) {
    std::cerr << "enable failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_response response{};
  if (!manager.health("sample.plugin", response, error) || response.status != 200) {
    std::cerr << "health failed: " << error << '\n';
    return 1;
  }
  const std::vector<uint8_t> binary{0x00, 0x01, 0x7f, 0x80, 0xff};
  if (!manager.websocket("sample.plugin", "socket-1", binary.data(), binary.size(), false, error) || recorder.stream("socket-1") != std::string(reinterpret_cast<const char*>(binary.data()), binary.size()) || recorder.finished("socket-1")) {
    std::cerr << "WebSocket stream callback failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_request sse_request{"GET", "/events", "{}", nullptr, 0};
  if (!manager.sse("sample.plugin", "stream-1", sse_request, error) || recorder.stream("stream-1") != "data: sample-plugin\n\n" || !recorder.finished("stream-1")) {
    std::cerr << "SSE stream callback failed: " << error << '\n';
    return 1;
  }
  if (!manager.file_stream("sample.plugin", "file-1", sse_request, error) || recorder.opened_status("file-1") != 200 || recorder.opened_headers("file-1").find("application/octet-stream") == std::string::npos || recorder.stream("file-1") != "sample-file-stream" || !recorder.finished("file-1")) {
    std::cerr << "file stream callback failed: " << error << '\n';
    return 1;
  }
  error.clear();
  if (manager.cancel_sse("sample.plugin", "inactive-stream", "test", error) || error.find("does not support SSE cancellation") == std::string::npos) {
    std::cerr << "ABI v2 plugin did not reject SSE cancellation\n";
    return 1;
  }

  if (!manager.enable("cancellable.plugin", error) || manager.info_snapshot("cancellable.plugin")->state != plugmesh::PluginState::Enabled) {
    std::cerr << "cancellable plugin enable failed: " << error << '\n';
    return 1;
  }
  bool cancellable_sse_ok = false;
  std::string cancellable_sse_error;
  std::thread blocking_sse([&] {
    plugmesh_http_request request{"GET", "/cancel-events", "{}", nullptr, 0};
    cancellable_sse_ok = manager.sse("cancellable.plugin", "cancel-1", request, cancellable_sse_error);
  });
  recorder.wait_for_log("sse.started:cancel-1");
  error.clear();
  if (!recorder.has_log("sse.started:cancel-1") || !manager.cancel_sse("cancellable.plugin", "cancel-1", "Client disconnected", error)) {
    std::cerr << "manager SSE cancellation failed: " << error << '\n';
    if (blocking_sse.joinable()) blocking_sse.join();
    return 1;
  }
  blocking_sse.join();
  if (!cancellable_sse_ok) {
    std::cerr << "cancellable SSE failed to return: " << cancellable_sse_error << '\n';
    return 1;
  }
  if (!recorder.has_log("sse.cancelled:cancel-1") || recorder.stream("cancel-1") != "data: cancelled\n\n" || !recorder.finished("cancel-1")) {
    std::cerr << "plugin cancellation callback or stream acknowledgement was missing\n";
    return 1;
  }
  if (!manager.health("cancellable.plugin", response, error) || response.status != 200) {
    std::cerr << "manager did not recover after SSE cancellation: " << error << '\n';
    return 1;
  }

  if (!manager.disable("sample.plugin", error) || manager.info_snapshot("sample.plugin")->state != plugmesh::PluginState::Disabled || !manager.reload("sample.plugin", error) || manager.info_snapshot("sample.plugin")->state != plugmesh::PluginState::Disabled || !manager.unload("sample.plugin", error) || manager.info_snapshot("sample.plugin")->state != plugmesh::PluginState::Unloaded) {
    std::cerr << "disable/reload/unload failed: " << error << '\n';
    return 1;
  }
  if (!manager.disable("cancellable.plugin", error) || !manager.unload("cancellable.plugin", error)) {
    std::cerr << "cancellable plugin cleanup failed: " << error << '\n';
    return 1;
  }
  const auto source_library = manager.info_snapshot("sample.plugin")->library;
  const auto traversal_root = std::filesystem::temp_directory_path() / ("plugmesh-plugin-path-smoke-" + std::to_string(std::chrono::steady_clock::now().time_since_epoch().count()));
  const auto traversal_plugin = traversal_root / "traversal.plugin";
  const auto outside_library = traversal_root / ("outside" + source_library.extension().string());
  std::filesystem::create_directories(traversal_plugin);
  std::filesystem::copy_file(source_library, outside_library);
  std::ofstream manifest(traversal_plugin / "manifest.json");
  manifest << "{\"id\":\"traversal.plugin\",\"name\":\"Traversal Plugin\",\"version\":\"0.1.0\",\"abiVersion\":\"2\",\"library\":\"../" << outside_library.filename().string() << "\",\"capabilities\":{\"http\":true,\"websocket\":false,\"sse\":false,\"fileStream\":false},\"permissions\":[],\"healthPath\":\"/health\"}";
  manifest.close();
  plugmesh::PluginManager traversal_manager;
  error.clear();
  const auto traversal_accepted = traversal_manager.discover(traversal_root, error);
  std::filesystem::remove_all(traversal_root);
  if (traversal_accepted) {
    std::cerr << "plugin library path traversal was accepted\n";
    return 1;
  }
  std::cout << "plugin lifecycle and SSE cancellation smoke test passed\n";
  return 0;
}
