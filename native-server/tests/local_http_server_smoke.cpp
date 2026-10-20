#include "plugmesh/local_http_server.h"

#include <cstdlib>
#include <iostream>

int main() {
  const auto port = static_cast<uint16_t>(std::strtoul(std::getenv("PLUGMESH_SMOKE_PORT") ? std::getenv("PLUGMESH_SMOKE_PORT") : "18766", nullptr, 10));
  plugmesh::LocalHttpServer server(port);
  std::string error;
  if (!server.run(error)) {
    std::cerr << "local HTTP server stopped: " << error << '\n';
    return 1;
  }
  return 0;
}
