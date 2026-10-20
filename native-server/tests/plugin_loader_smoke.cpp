#include "plugmesh/plugin_loader.h"

#include <filesystem>
#include <iostream>

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: plugmesh-plugin-loader-smoke <plugin-library>\n";
    return 2;
  }
  plugmesh::PluginLoader loader;
  std::string error;
  const auto library = std::filesystem::path(argv[1]);
  if (loader.load(library.parent_path() / "missing-plugin-library", error) || error.empty()) {
    std::cerr << "missing plugin library was not rejected\n";
    return 1;
  }
  error.clear();
  if (!loader.load(argv[1], error)) {
    std::cerr << error << '\n';
    return 1;
  }
  if (std::string(loader.api()->plugin_id) != "sample.plugin") {
    std::cerr << "unexpected plugin id\n";
    return 1;
  }
  if (loader.api()->start(nullptr) != 0 || loader.api()->stop() != 0) {
    std::cerr << "plugin lifecycle failed\n";
    return 1;
  }
  std::cout << "plugin ABI smoke test passed\n";
  return 0;
}
