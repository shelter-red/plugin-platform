#pragma once

#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <functional>
#include <mutex>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

class PluginManager;

class LocalHttpServer {
 public:
  using StatusProvider = std::function<nlohmann::json()>;
  using RegistrationHandler = std::function<nlohmann::json(const nlohmann::json&, std::string&)>;
  using CredentialActionHandler = std::function<nlohmann::json(const std::string&, const nlohmann::json&, std::string&)>;
  using PasswordSetupHandler = std::function<bool(const std::string&, const nlohmann::json&, std::string&)>;
  using LogProvider = std::function<nlohmann::json()>;

  explicit LocalHttpServer(uint16_t port = 8787, PluginManager* plugins = nullptr, StatusProvider status_provider = {}, std::filesystem::path ui_directory = {}, RegistrationHandler registration_handler = {}, LogProvider log_provider = {}, CredentialActionHandler credential_action_handler = {}, std::string local_ui_password_verifier = {}, PasswordSetupHandler password_setup_handler = {});
  LocalHttpServer(const LocalHttpServer&) = delete;
  LocalHttpServer& operator=(const LocalHttpServer&) = delete;

  bool run(std::string& error);
  void stop();

 private:
  void handle_http(void* handle);
  bool serve_static(void* handle, const std::string& resource, bool& forbidden) const;
  bool is_authenticated(const std::string& cookie_header) const;
  bool login_rate_limited();
  void record_failed_login();
  bool create_session(std::string& token, std::string& error);
  void clear_session(const std::string& cookie_header);

  uint16_t port_;
  PluginManager* plugins_;
  StatusProvider status_provider_;
  std::filesystem::path ui_directory_;
  RegistrationHandler registration_handler_;
  LogProvider log_provider_;
  CredentialActionHandler credential_action_handler_;
  std::string local_ui_password_verifier_;
  PasswordSetupHandler password_setup_handler_;
  mutable std::mutex session_mutex_;
  std::string session_token_;
  std::deque<std::chrono::steady_clock::time_point> failed_logins_;
  std::atomic<bool> stopping_{false};
  std::atomic<void*> server_{nullptr};
};

}  // namespace plugmesh
