#include "plugmesh/server_config.h"

#include <cstdlib>

namespace plugmesh {

namespace {
std::string read_env(const char* name) {
  const char* value = std::getenv(name);
  return value ? std::string(value) : std::string();
}
}  // namespace

ServerConfig load_config_from_environment() {
  ServerConfig config;
  config.worker_url = read_env("PLUGMESH_WORKER_URL");
  config.server_id = read_env("PLUGMESH_SERVER_ID");
  config.access_token = read_env("PLUGMESH_ACCESS_TOKEN");
  config.plugin_directory = read_env("PLUGMESH_PLUGIN_DIRECTORY");
  config.credential_file = read_env("PLUGMESH_CREDENTIAL_FILE");
  return config;
}

bool validate_config(const ServerConfig& config, std::string& error) {
  if (config.worker_url.empty()) {
    error = "PLUGMESH_WORKER_URL is required";
    return false;
  }
  if (config.server_id.empty()) {
    error = "PLUGMESH_SERVER_ID is required";
    return false;
  }
  if (config.access_token.empty()) {
    error = "PLUGMESH_ACCESS_TOKEN is required";
    return false;
  }
  if (config.plugin_directory.empty()) {
    error = "PLUGMESH_PLUGIN_DIRECTORY is required";
    return false;
  }
  return true;
}

}  // namespace plugmesh
