#include "plugmesh/server_config.h"

#include "plugmesh/credential_store.h"

#include <cstdlib>

#include <websocketpp/uri.hpp>

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
  config.local_ui_password_verifier = read_env("PLUGMESH_LOCAL_UI_PASSWORD_VERIFIER");
  config.plugin_directory = read_env("PLUGMESH_PLUGIN_DIRECTORY");
  config.credential_file = read_env("PLUGMESH_CREDENTIAL_FILE");
  return config;
}

bool load_persisted_config(ServerConfig& config, std::string& error) {
  if (!config.worker_url.empty() && !config.server_id.empty() && !config.access_token.empty()) return true;
  const auto password = read_env("PLUGMESH_CREDENTIAL_PASSWORD");
  return load_credentials_into_config(config.credential_file, password, config.worker_url, config.server_id, config.access_token, config.local_ui_password_verifier, error);
}

bool validate_worker_url(const std::string& worker_url, std::string& error) {
  const auto scheme_end = worker_url.find("://");
  if (scheme_end == std::string::npos || scheme_end + 3 >= worker_url.size()) {
    error = "worker URL must use http:// or https://";
    return false;
  }
  const websocketpp::uri uri(worker_url);
  if (!uri.get_valid() || (uri.get_scheme() != "http" && uri.get_scheme() != "https")) {
    error = "worker URL must use http:// or https://";
    return false;
  }
  const auto& host = uri.get_host();
  const auto loopback = host == "localhost" || host == "127.0.0.1" || host == "::1";
  if (!uri.get_secure() && !loopback) {
    error = "worker URL must use HTTPS unless it targets localhost";
    return false;
  }
  return true;
}

bool validate_binding_config(const ServerConfig& config, std::string& error) {
  if (config.worker_url.empty()) {
    error = "PLUGMESH_WORKER_URL is required";
    return false;
  }
  if (!validate_worker_url(config.worker_url, error)) return false;
  if (config.server_id.empty()) {
    error = "PLUGMESH_SERVER_ID is required";
    return false;
  }
  if (config.access_token.empty()) {
    error = "PLUGMESH_ACCESS_TOKEN is required";
    return false;
  }
  return true;
}

bool prepare_executable_plugin_directory(ServerConfig& config, const std::filesystem::path& executable_directory, std::string& error) {
  if (!config.plugin_directory.empty()) return true;
  config.plugin_directory = executable_directory / "plugins";
  std::error_code directory_error;
  std::filesystem::create_directories(config.plugin_directory, directory_error);
  if (directory_error) {
    error = "cannot create default plugin directory: " + config.plugin_directory.string() + ": " + directory_error.message();
    return false;
  }
  return true;
}

bool validate_config(const ServerConfig& config, std::string& error) {
  if (!validate_binding_config(config, error)) return false;
  if (config.plugin_directory.empty()) {
    error = "PLUGMESH_PLUGIN_DIRECTORY is required";
    return false;
  }
  return true;
}

}  // namespace plugmesh
