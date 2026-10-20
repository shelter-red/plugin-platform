#pragma once

#include <filesystem>
#include <string>

namespace plugmesh {

struct StoredCredentials {
  std::string worker_url;
  std::string server_id;
  std::string access_token;
};

bool system_credentials_available();
bool save_system_credentials(const StoredCredentials& credentials, std::string& error);
bool load_system_credentials(StoredCredentials& credentials, std::string& error);
bool save_credentials(const std::filesystem::path& path, const StoredCredentials& credentials, const std::string& password, std::string& error);
bool load_credentials(const std::filesystem::path& path, const std::string& password, StoredCredentials& credentials, std::string& error);
bool load_credentials_into_config(const std::filesystem::path& path, const std::string& password, std::string& worker_url, std::string& server_id, std::string& access_token, std::string& error);

}  // namespace plugmesh
