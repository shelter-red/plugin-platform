#pragma once

#include <filesystem>
#include <string>

namespace plugmesh {

struct ServerConfig {
  std::string worker_url;
  std::string server_id;
  std::string access_token;
  std::filesystem::path plugin_directory;
  std::filesystem::path credential_file;
};

ServerConfig load_config_from_environment();
bool validate_config(const ServerConfig& config, std::string& error);

}  // namespace plugmesh
