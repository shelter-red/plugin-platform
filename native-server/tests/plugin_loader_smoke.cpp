#include "plugmesh/plugin_loader.h"

#include <filesystem>
#include <iostream>
#include <string>

namespace {

bool load_and_check(const std::string& library_path, uint32_t expected_abi, const std::string& expected_id, std::string& error) {
  plugmesh::PluginLoader loader;
  if (!loader.load(library_path, error)) return false;
  if (loader.abi_version() != expected_abi || !loader.api() || std::string(loader.api()->plugin_id) != expected_id) {
    error = "unexpected plugin ABI or id for " + library_path;
    return false;
  }
  if (loader.api()->start(nullptr) != 0 || loader.api()->stop() != 0) {
    error = "plugin lifecycle failed for " + library_path;
    return false;
  }
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 4) {
    std::cerr << "usage: plugmesh-plugin-loader-smoke <abi-v2-library> <abi-v3-library> <abi-v4-library>\n";
    return 2;
  }
  plugmesh::PluginLoader missing;
  std::string error;
  const auto missing_library = std::filesystem::path(argv[1]).parent_path() / "missing-plugin-library";
  if (missing.load(missing_library, error) || error.empty()) {
    std::cerr << "missing plugin library was not rejected\n";
    return 1;
  }
  if (!load_and_check(argv[1], PLUGMESH_PLUGIN_ABI_VERSION, "sample.plugin", error) ||
      !load_and_check(argv[2], PLUGMESH_PLUGIN_ABI_VERSION_V3, "lifecycle.plugin", error) ||
      !load_and_check(argv[3], PLUGMESH_PLUGIN_ABI_VERSION_V4, "cancellable.plugin", error)) {
    std::cerr << error << '\n';
    return 1;
  }
  std::cout << "plugin ABI v2/v3/v4 loader smoke test passed\n";
  return 0;
}
