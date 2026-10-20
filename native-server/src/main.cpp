#include "plugmesh/control_client.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/registration_client.h"
#include "plugmesh/server_config.h"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

std::string read_value(const char* environment_name, const char* prompt) {
  if (const char* value = std::getenv(environment_name); value && *value) return value;
  std::cout << prompt;
  std::string value;
  std::getline(std::cin, value);
  return value;
}

int register_server(int argc, char** argv) {
  if (argc != 5) {
    std::cerr << "usage: plugmesh-server --register <worker-url> <server-name> <credential-file>\n";
    return 2;
  }
  const auto code = read_value("PLUGMESH_REGISTRATION_CODE", "Registration code: ");
  const auto password = read_value("PLUGMESH_CREDENTIAL_PASSWORD", "Credential password: ");
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
  std::cout << "plugmesh-server discovered " << plugins.plugins().size() << " plugin(s) for " << resolved_config.server_id << '\n';
  plugmesh::ControlClient client(resolved_config, plugins);
  if (!client.run(error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  return 0;
}
