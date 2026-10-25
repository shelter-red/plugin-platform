#pragma once

#include <filesystem>
#include <nlohmann/json_fwd.hpp>
#include <string>

namespace plugmesh {

struct StoredCredentials {
  std::string worker_url;
  std::string server_id;
  std::string access_token;
  std::string local_ui_password_verifier;
};

bool make_local_ui_password_verifier(const std::string& password, std::string& verifier, std::string& error);
bool verify_local_ui_password(const std::string& password, const std::string& verifier);
bool make_local_ui_password_challenge(const std::string& verifier, nlohmann::json& challenge, std::string& error);
bool make_local_ui_password_proof(const std::string& password, const nlohmann::json& challenge, const std::string& context, std::string& proof, std::string& error);
bool verify_local_ui_password_proof(const std::string& verifier, const nlohmann::json& challenge, const std::string& context, const std::string& proof);
bool system_credentials_available();
bool save_system_credentials(const StoredCredentials& credentials, std::string& error);
bool load_system_credentials(StoredCredentials& credentials, std::string& error);
bool remove_system_credentials(std::string& error);
bool save_credentials(const std::filesystem::path& path, const StoredCredentials& credentials, const std::string& password, std::string& error);
bool load_credentials(const std::filesystem::path& path, const std::string& password, StoredCredentials& credentials, std::string& error);
bool remove_credentials(const std::filesystem::path& path, std::string& error);
bool load_credentials_into_config(const std::filesystem::path& path, const std::string& password, std::string& worker_url, std::string& server_id, std::string& access_token, std::string& local_ui_password_verifier, std::string& error);

}  // namespace plugmesh
