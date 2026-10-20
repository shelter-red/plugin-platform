#include "plugmesh/plugin_manager.h"

#include <filesystem>
#include <iostream>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: plugmesh-plugin-manager-smoke <plugin-directory>\n";
    return 2;
  }
  plugmesh::PluginManager manager;
  std::string error;
  if (!manager.discover(std::filesystem::path(argv[1]), error) || manager.plugins().size() != 1 || manager.plugins()[0].id != "sample.plugin") {
    std::cerr << "discovery failed: " << error << '\n';
    return 1;
  }
  if (!manager.load("sample.plugin", error) || manager.plugins()[0].state != plugmesh::PluginState::Loaded) {
    std::cerr << "load failed: " << error << '\n';
    return 1;
  }
  if (!manager.enable("sample.plugin", error) || manager.plugins()[0].state != plugmesh::PluginState::Enabled) {
    std::cerr << "enable failed: " << error << '\n';
    return 1;
  }
  plugmesh_http_response response{};
  if (!manager.health("sample.plugin", response, error) || response.status != 200) {
    std::cerr << "health failed: " << error << '\n';
    return 1;
  }
  if (!manager.disable("sample.plugin", error) || manager.plugins()[0].state != plugmesh::PluginState::Disabled || !manager.unload("sample.plugin", error) || manager.plugins()[0].state != plugmesh::PluginState::Unloaded) {
    std::cerr << "disable/unload failed: " << error << '\n';
    return 1;
  }
  std::cout << "plugin lifecycle smoke test passed\n";
  return 0;
}
