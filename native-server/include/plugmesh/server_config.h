#pragma once

#include <filesystem>
#include <string>

namespace plugmesh {

struct ServerConfig {
  std::string worker_url;
  std::string server_id;
  std::string access_token;
  std::string local_ui_password_verifier;
  std::filesystem::path plugin_directory;
  std::filesystem::path credential_file;
  std::filesystem::path tunnel_trust_file;
  std::filesystem::path port_mappings_file;
};

ServerConfig load_config_from_environment();
bool load_persisted_config(ServerConfig& config, std::string& error);
bool validate_worker_url(const std::string& worker_url, std::string& error);
bool validate_binding_config(const ServerConfig& config, std::string& error);
bool prepare_executable_plugin_directory(ServerConfig& config, const std::filesystem::path& executable_directory, std::string& error);
bool validate_config(const ServerConfig& config, std::string& error);

}  // namespace plugmesh
