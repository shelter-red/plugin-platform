#include "plugmesh/control_client.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/server_config.h"

#include <iostream>

int main() {
  const auto config = plugmesh::load_config_from_environment();
  std::string error;
  auto resolved_config = config;
  if (!plugmesh::load_persisted_config(resolved_config, error) || !plugmesh::validate_config(resolved_config, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  plugmesh::PluginManager plugins;
  if (!plugins.discover(resolved_config.plugin_directory, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  std::cout << "plugmesh-server discovered " << plugins.plugins().size() << " plugin(s) for " << resolved_config.server_id << '\n';
  plugmesh::ControlClient client(resolved_config, plugins);
  if (!client.run(error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  return 0;
}
