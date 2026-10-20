#include "plugmesh/control_client.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/local_http_server.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/registration_client.h"
#include "plugmesh/server_config.h"

#include <cstdlib>
#include <cstdint>
#include <atomic>
#include <chrono>
#include <iostream>
#include <string>
#include <thread>

#ifdef _WIN32
#include <windows.h>
#else
#include <termios.h>
#include <unistd.h>
#endif

namespace {

std::string read_value(const char* environment_name, const char* prompt) {
  if (const char* value = std::getenv(environment_name); value && *value) return value;
  std::cout << prompt;
  std::string value;
  std::getline(std::cin, value);
  return value;
}

std::string read_secret(const char* environment_name, const char* prompt) {
  if (const char* value = std::getenv(environment_name); value && *value) return value;
  std::cout << prompt << std::flush;

#ifdef _WIN32
  const auto input = GetStdHandle(STD_INPUT_HANDLE);
  DWORD mode = 0;
  if (input != INVALID_HANDLE_VALUE && GetConsoleMode(input, &mode)) {
    SetConsoleMode(input, mode & ~ENABLE_ECHO_INPUT);
    std::string value;
    std::getline(std::cin, value);
    SetConsoleMode(input, mode);
    std::cout << '\n';
    return value;
  }
#else
  termios original{};
  if (tcgetattr(STDIN_FILENO, &original) == 0) {
    auto hidden = original;
    hidden.c_lflag &= static_cast<tcflag_t>(~ECHO);
    if (tcsetattr(STDIN_FILENO, TCSANOW, &hidden) == 0) {
      std::string value;
      std::getline(std::cin, value);
      tcsetattr(STDIN_FILENO, TCSANOW, &original);
      std::cout << '\n';
      return value;
    }
  }
#endif

  std::string value;
  std::getline(std::cin, value);
  return value;
}

uint16_t local_port() {
  const char* value = std::getenv("PLUGMESH_LOCAL_PORT");
  if (!value || !*value) return 8787;
  char* end = nullptr;
  const auto parsed = std::strtoul(value, &end, 10);
  return end != value && *end == '\0' && parsed > 0 && parsed <= 65535 ? static_cast<uint16_t>(parsed) : 8787;
}

std::filesystem::path local_ui_directory() {
  if (const char* value = std::getenv("PLUGMESH_LOCAL_UI_DIRECTORY"); value && *value) return value;
  return std::filesystem::path("native-ui") / "dist";
}

bool run_registration_setup(plugmesh::ServerConfig& config, uint16_t port, const std::filesystem::path& ui_directory, std::string& error) {
  const auto initial_credential_file = config.credential_file.string();
  std::atomic<bool> registration_complete{false};
  std::atomic<bool> callback_active{false};
  std::atomic<bool> server_failed{false};
  bool registered = false;
  std::string server_error;
  plugmesh::LocalHttpServer local_http(port, nullptr, [initial_credential_file] {
    return nlohmann::json{{"configured", false}, {"connected", false}, {"credentialFile", initial_credential_file}, {"systemCredentialsAvailable", plugmesh::system_credentials_available()}};
  }, ui_directory, [&config, &registration_complete, &callback_active, &registered](const nlohmann::json& payload, std::string& callback_error) {
    callback_active = true;
    const auto text = [&](const char* key) {
      return payload.contains(key) && payload.at(key).is_string() ? payload.at(key).get<std::string>() : std::string();
    };
    const auto worker_url = text("workerUrl");
    const auto server_name = text("serverName");
    const auto code = text("registrationCode");
    const auto password = text("credentialPassword");
    const auto credential_file = text("credentialFile").empty() ? config.credential_file.string() : text("credentialFile");
    const auto use_system_store = credential_file.empty();
    if (worker_url.empty() || server_name.empty() || code.empty() || (!use_system_store && password.empty()) || (use_system_store && !plugmesh::system_credentials_available())) {
      callback_error = use_system_store ? "当前平台没有可用的系统凭据存储，请填写凭据文件路径和口令" : "Worker 地址、服务器名称、注册码、凭据口令和凭据文件路径均为必填";
      callback_active = false;
      return nlohmann::json::object();
    }

    plugmesh::RegistrationResult registration;
    if (!plugmesh::register_server(worker_url, code, server_name, registration, callback_error)) {
      callback_active = false;
      return nlohmann::json::object();
    }
    const plugmesh::StoredCredentials credentials{worker_url, registration.server_id, registration.access_token};
    if (!plugmesh::save_credentials(credential_file, credentials, password, callback_error)) {
      callback_active = false;
      return nlohmann::json::object();
    }

    config.worker_url = worker_url;
    config.server_id = registration.server_id;
    config.access_token = registration.access_token;
    config.credential_file = credential_file;
    registered = true;
    callback_active = false;
    registration_complete = true;
    return nlohmann::json{{"serverId", registration.server_id}, {"credentialFile", credential_file}};
  });
  std::thread local_thread([&local_http, &server_error, &server_failed] {
    if (!local_http.run(server_error)) {
      server_failed = true;
      if (!server_error.empty()) std::cerr << "plugmesh-server local setup: " << server_error << '\n';
    }
  });
  while ((!registration_complete || callback_active) && !server_failed) std::this_thread::sleep_for(std::chrono::milliseconds(50));
  local_http.stop();
  if (local_thread.joinable()) local_thread.join();
  if (server_failed) {
    error = server_error.empty() ? "local setup server stopped unexpectedly" : server_error;
    return false;
  }
  if (!registered) {
    error = "local registration did not complete";
    return false;
  }
  return true;
}

int register_server(int argc, char** argv) {
  if (argc != 5) {
    std::cerr << "usage: plugmesh-server --register <worker-url> <server-name> <credential-file>\n";
    return 2;
  }
  const auto code = read_value("PLUGMESH_REGISTRATION_CODE", "Registration code: ");
  const auto password = read_secret("PLUGMESH_CREDENTIAL_PASSWORD", "Credential password: ");
  plugmesh::RegistrationResult registration;
  std::string error;
  if (!plugmesh::register_server(argv[2], code, argv[3], registration, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  const plugmesh::StoredCredentials credentials{argv[2], registration.server_id, registration.access_token};
  if (!plugmesh::save_credentials(argv[4], credentials, password, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  std::cout << "server registered as " << registration.server_id << "\n";
  std::cout << "credentials saved to " << argv[4] << "\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--register") return register_server(argc, argv);
  const auto config = plugmesh::load_config_from_environment();
  std::string error;
  auto resolved_config = config;
  if (!plugmesh::load_persisted_config(resolved_config, error) || !plugmesh::validate_config(resolved_config, error)) {
    std::cerr << "plugmesh-server: entering local setup (" << error << ")\n";
    if (!run_registration_setup(resolved_config, local_port(), local_ui_directory(), error)) {
      std::cerr << "plugmesh-server: " << error << '\n';
      return 2;
    }
  }
  if (!plugmesh::validate_config(resolved_config, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  plugmesh::PluginManager plugins;
  if (!plugins.discover(resolved_config.plugin_directory, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 2;
  }
  std::cout << "plugmesh-server discovered " << plugins.snapshot().size() << " plugin(s) for " << resolved_config.server_id << '\n';
  plugmesh::ControlClient client(resolved_config, plugins);
  plugmesh::LocalHttpServer local_http(local_port(), &plugins, [&client, &resolved_config] {
    return nlohmann::json{{"configured", true}, {"serverId", resolved_config.server_id}, {"workerUrl", resolved_config.worker_url}, {"credentialFile", resolved_config.credential_file.string()}, {"systemCredentialsAvailable", plugmesh::system_credentials_available()}, {"connected", client.connected()}};
  }, local_ui_directory());
  std::string local_error;
  std::thread local_thread([&local_http, &local_error] {
    if (!local_http.run(local_error) && !local_error.empty()) std::cerr << "plugmesh-server local UI: " << local_error << '\n';
  });
  const auto connected = client.run(error);
  local_http.stop();
  if (local_thread.joinable()) local_thread.join();
  if (!connected) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  return 0;
}
