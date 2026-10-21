#include "plugmesh/plugin_manager.h"

#include <iostream>
#include <string>
#include <vector>

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: plugmesh-plugin-websocket-lifecycle-smoke <plugin-host> <plugin-directory>\n";
    return 2;
  }
  plugmesh::PluginManager manager;
  manager.set_host_executable(argv[1]);
  std::vector<std::string> logs;
  manager.set_log_writer([&](int, const char* message) {
    if (message) logs.emplace_back(message);
  });
  std::string error;
  if (!manager.discover(argv[2], error) || !manager.load("lifecycle.plugin", error) || !manager.enable("lifecycle.plugin", error)) {
    std::cerr << "lifecycle plugin setup failed: " << error << '\n';
    return 1;
  }
  if (!manager.websocket_open("lifecycle.plugin", "socket-1", "/chat", "{\"x-test\":\"ok\"}", error)) {
    std::cerr << "WebSocket open callback failed: " << error << '\n';
    return 1;
  }
  if (logs.empty() || logs.back() != "websocket.open:socket-1:/chat:{\"x-test\":\"ok\"}") {
    std::cerr << "WebSocket open callback payload failed\n";
    return 1;
  }
  if (!manager.websocket_close("lifecycle.plugin", "socket-1", 1001, "going away", error)) {
    std::cerr << "WebSocket close callback failed: " << error << '\n';
    return 1;
  }
  if (logs.empty() || logs.back() != "websocket.close:socket-1:1001:going away") {
    std::cerr << "WebSocket close callback payload failed\n";
    return 1;
  }
  std::cout << "WebSocket lifecycle smoke test passed\n";
  return 0;
}
