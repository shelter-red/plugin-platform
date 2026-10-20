#include "plugmesh/server_config.h"

#include <iostream>

int main() {
  const auto config = plugmesh::load_config_from_environment();
  std::string error;
  if (!plugmesh::validate_config(config, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  std::cout << "plugmesh-server configuration accepted for " << config.server_id << '\n';
  std::cout << "network transport is not enabled in this foundation build\n";
  return 0;
}
