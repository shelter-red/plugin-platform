#include "plugmesh/control_client.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/local_http_server.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/registration_client.h"
#include "plugmesh/server_config.h"

#include <cstdlib>
#include <cstdint>
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
    return nlohmann::json{{"serverId", resolved_config.server_id}, {"workerUrl", resolved_config.worker_url}, {"connected", client.connected()}};
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
