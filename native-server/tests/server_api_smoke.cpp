#include "plugmesh/server_api.h"

#include <cassert>
#include <chrono>
#include <cstring>
#include <thread>

int main(int argc, char** argv) {
  char error[256]{};
  assert(plugmesh_server_create(nullptr, error, sizeof(error)) == nullptr);
  assert(std::strcmp(error, "server configuration is required") == 0);

  const char* plugin_directory = argc > 1 ? argv[1] : ".";
  const plugmesh_server_config config{
      "http://127.0.0.1:1",
      "server-api-smoke",
      "test-access-token",
      plugin_directory,
      "",
  };
  auto* server = plugmesh_server_create(&config, error, sizeof(error));
  assert(server != nullptr);
  assert(!plugmesh_server_is_running(server));
  assert(plugmesh_server_start(server) == 1);
  std::this_thread::sleep_for(std::chrono::milliseconds(20));
  assert(plugmesh_server_is_running(server));
  plugmesh_server_stop(server);
  assert(!plugmesh_server_is_running(server));
  plugmesh_server_destroy(server);
  return 0;
}
