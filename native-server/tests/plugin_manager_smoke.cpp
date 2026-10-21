#include "plugmesh/plugin_manager.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: plugmesh-plugin-manager-smoke <plugin-directory>\n";
    return 2;
  }
  plugmesh::PluginManager manager;
  std::string stream_id;
  std::vector<uint8_t> streamed;
  std::vector<std::string> logs;
  bool finished = false;
  uint16_t opened_status = 0;
  std::string opened_headers;
  manager.set_stream_opener([&](const char* id, uint16_t status, const char* headers) {
    stream_id = id ? id : "";
    opened_status = status;
    opened_headers = headers ? headers : "";
    return 0;
  });
  manager.set_log_writer([&](int, const char* message) {
    if (message) logs.emplace_back(message);
  });
  manager.set_stream_writer([&](const char* id, const uint8_t* data, uint64_t size, int is_finished) {
    stream_id = id ? id : "";
    streamed.assign(data, data + size);
    finished = is_finished != 0;
    return 0;
  });
  std::string error;
  if (!manager.discover(std::filesystem::path(argv[1]), error) || manager.snapshot().size() != 1 || manager.snapshot()[0].id != "sample.plugin" || manager.snapshot()[0].health_path != "/health") {
    std::cerr << "discovery failed: " << error << '\n';
    return 1;
  }
  if (!manager.load("sample.plugin", error) || manager.snapshot()[0].state != plugmesh::PluginState::Loaded) {
    std::cerr << "load failed: " << error << '\n';
    return 1;
  }
  if (logs.empty() || logs.back() != "plugin loaded: sample.plugin") {
    std::cerr << "plugin log callback failed\n";
    return 1;
  }
  if (!manager.enable("sample.plugin", error) || manager.snapshot()[0].state != plugmesh::PluginState::Enabled) {
    std::cerr << "enable failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_response response{};
  if (!manager.health("sample.plugin", response, error) || response.status != 200) {
    std::cerr << "health failed: " << error << '\n';
    return 1;
  }
  const std::vector<uint8_t> binary{0x00, 0x01, 0x7f, 0x80, 0xff};
  if (!manager.websocket("sample.plugin", "socket-1", binary.data(), binary.size(), false, error) || stream_id != "socket-1" || streamed != binary || finished) {
    std::cerr << "WebSocket stream callback failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_request sse_request{"GET", "/events", "{}", nullptr, 0};
  if (!manager.sse("sample.plugin", "stream-1", sse_request, error) || stream_id != "stream-1" || std::string(streamed.begin(), streamed.end()) != "data: sample-plugin\n\n" || !finished) {
    std::cerr << "SSE stream callback failed: " << error << '\n';
    return 1;
  }
  if (!manager.file_stream("sample.plugin", "file-1", sse_request, error) || stream_id != "file-1" || opened_status != 200 || opened_headers.find("application/octet-stream") == std::string::npos || std::string(streamed.begin(), streamed.end()) != "sample-file-stream" || !finished) {
    std::cerr << "file stream callback failed: " << error << '\n';
    return 1;
  }
  if (!manager.disable("sample.plugin", error) || manager.snapshot()[0].state != plugmesh::PluginState::Disabled || !manager.reload("sample.plugin", error) || manager.snapshot()[0].state != plugmesh::PluginState::Disabled || !manager.unload("sample.plugin", error) || manager.snapshot()[0].state != plugmesh::PluginState::Unloaded) {
    std::cerr << "disable/reload/unload failed: " << error << '\n';
    return 1;
  }
  const auto source_library = manager.snapshot()[0].library;
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
  std::cout << "plugin lifecycle smoke test passed\n";
  return 0;
}
