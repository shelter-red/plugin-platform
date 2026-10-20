#include "plugmesh/local_http_server.h"
#include "plugmesh/plugin_manager.h"

#include <cstdlib>
#include <filesystem>
#include <iostream>

int main(int argc, char** argv) {
  const auto port = static_cast<uint16_t>(std::strtoul(std::getenv("PLUGMESH_SMOKE_PORT") ? std::getenv("PLUGMESH_SMOKE_PORT") : "18766", nullptr, 10));
  plugmesh::PluginManager plugins;
  if (argc == 2) {
    std::string error;
    if (!plugins.discover(std::filesystem::path(argv[1]), error)) {
      std::cerr << "plugin discovery failed: " << error << '\n';
      return 1;
    }
  }
  plugmesh::LocalHttpServer server(port, &plugins, [&plugins] {
    return nlohmann::json{{"connected", false}, {"pluginCount", plugins.snapshot().size()}};
  });
  std::string error;
  if (!server.run(error)) {
    std::cerr << "local HTTP server stopped: " << error << '\n';
    return 1;
  }
  return 0;
}
