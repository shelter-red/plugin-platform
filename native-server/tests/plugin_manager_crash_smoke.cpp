#include "plugmesh/plugin_manager.h"

#include <iostream>
#include <string>

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: plugmesh-plugin-manager-crash-smoke <plugin-host> <plugin-directory>\n";
    return 2;
  }
  plugmesh::PluginManager manager;
  manager.set_host_executable(argv[1]);
  std::string error;
  if (!manager.discover(argv[2], error) || !manager.enable("crashing.plugin", error)) {
    std::cerr << "crashing plugin setup failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_response health{};
  if (!manager.health("crashing.plugin", health, error) || health.status != 200) {
    std::cerr << "crashing plugin health failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_request request{"GET", "/crash", "{}", nullptr, 0};
  plugmesh_http_response response{};
  error.clear();
  if (manager.http("crashing.plugin", request, response, error)) {
    std::cerr << "crashing plugin unexpectedly returned a response\n";
    return 1;
  }
  if (error.empty()) {
    std::cerr << "plugin crash did not report an error\n";
    return 1;
  }
  const auto crashed = manager.info_snapshot("crashing.plugin");
  if (!crashed || crashed->state != plugmesh::PluginState::Failed || crashed->last_error.empty()) {
    std::cerr << "plugin crash did not mark the plugin as failed\n";
    return 1;
  }
  if (!manager.enable("sample.plugin", error) || !manager.health("sample.plugin", health, error) || health.status != 200) {
    std::cerr << "manager did not survive the plugin crash: " << error << '\n';
    return 1;
  }
  if (!manager.enable("crashing.plugin", error) || !manager.health("crashing.plugin", health, error)) {
    std::cerr << "plugin did not recover after reload: " << error << '\n';
    return 1;
  }
  std::cout << "plugin crash isolation smoke test passed\n";
  return 0;
}
