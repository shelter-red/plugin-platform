#pragma once

#include <atomic>
#include <cstdint>
#include <filesystem>
#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

class PluginManager;

class LocalHttpServer {
 public:
  using StatusProvider = std::function<nlohmann::json()>;
  using RegistrationHandler = std::function<nlohmann::json(const nlohmann::json&, std::string&)>;
  using CredentialActionHandler = std::function<nlohmann::json(const std::string&, const nlohmann::json&, std::string&)>;
  using LogProvider = std::function<nlohmann::json()>;

  explicit LocalHttpServer(uint16_t port = 8787, PluginManager* plugins = nullptr, StatusProvider status_provider = {}, std::filesystem::path ui_directory = {}, RegistrationHandler registration_handler = {}, LogProvider log_provider = {}, CredentialActionHandler credential_action_handler = {});
  LocalHttpServer(const LocalHttpServer&) = delete;
  LocalHttpServer& operator=(const LocalHttpServer&) = delete;

  bool run(std::string& error);
  void stop();

 private:
  void handle_http(void* handle);
  bool serve_static(void* handle, const std::string& resource, bool& forbidden) const;

  uint16_t port_;
  PluginManager* plugins_;
  StatusProvider status_provider_;
  std::filesystem::path ui_directory_;
  RegistrationHandler registration_handler_;
  LogProvider log_provider_;
  CredentialActionHandler credential_action_handler_;
  std::atomic<bool> stopping_{false};
  std::atomic<void*> server_{nullptr};
};

}  // namespace plugmesh
