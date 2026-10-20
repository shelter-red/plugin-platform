#include "plugmesh/local_http_server.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/plugin_manager.h"

#include <cstdlib>
#include <filesystem>
#include <iostream>

int main(int argc, char** argv) {
  const auto port = static_cast<uint16_t>(std::strtoul(std::getenv("PLUGMESH_SMOKE_PORT") ? std::getenv("PLUGMESH_SMOKE_PORT") : "18766", nullptr, 10));
  plugmesh::PluginManager plugins;
  if (argc == 2) {
    std::string error;
    if (!plugins.discover(std::filesystem::path(argv[1]), error)) {
      std::cerr << "plugin discovery failed: " << error << '\n';
      return 1;
    }
  }
  const auto ui_directory = std::getenv("PLUGMESH_SMOKE_UI_DIRECTORY") ? std::filesystem::path(std::getenv("PLUGMESH_SMOKE_UI_DIRECTORY")) : std::filesystem::path();
  const auto registration_enabled = std::getenv("PLUGMESH_SMOKE_REGISTER") != nullptr;
  const auto legacy_credentials = std::getenv("PLUGMESH_SMOKE_LEGACY_CREDENTIALS") != nullptr;
  std::string verifier;
  std::string verifier_error;
  if (!registration_enabled && !legacy_credentials && !plugmesh::make_local_ui_password_verifier("smoke-password", verifier, verifier_error)) {
    std::cerr << "password verifier setup failed: " << verifier_error << '\n';
    return 1;
  }
  plugmesh::LocalHttpServer server(port, &plugins, [&, registration_enabled] {
    return nlohmann::json{{"configured", !registration_enabled}, {"connected", false}, {"pluginCount", plugins.snapshot().size()}};
  }, ui_directory, registration_enabled ? plugmesh::LocalHttpServer::RegistrationHandler([](const nlohmann::json& payload, std::string& error) {
    if (!payload.value("registrationCode", std::string()).empty()) return nlohmann::json{{"serverId", "smoke-server"}};
    error = "registrationCode is required";
    return nlohmann::json::object();
  }) : plugmesh::LocalHttpServer::RegistrationHandler{}, {}, {}, verifier, legacy_credentials ? plugmesh::LocalHttpServer::PasswordSetupHandler([](const std::string& next_verifier, const nlohmann::json&, std::string&) {
    return !next_verifier.empty();
  }) : plugmesh::LocalHttpServer::PasswordSetupHandler{});
  std::string error;
  if (!server.run(error)) {
    std::cerr << "local HTTP server stopped: " << error << '\n';
    return 1;
  }
  return 0;
}
