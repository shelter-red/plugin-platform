#include "plugmesh/control_client.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/server_config.h"

#include <iostream>

int main() {
  const auto config = plugmesh::load_config_from_environment();
  std::string error;
  if (!plugmesh::validate_config(config, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  plugmesh::PluginManager plugins;
  if (!plugins.discover(config.plugin_directory, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  std::cout << "plugmesh-server discovered " << plugins.plugins().size() << " plugin(s) for " << config.server_id << '\n';
  plugmesh::ControlClient client(config, plugins);
  if (!client.run(error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  return 0;
}
