#include "plugmesh/credential_store.h"
#include "plugmesh/local_http_server.h"
#include "plugmesh/plugin_manager.h"

#include <atomic>
#include <charconv>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>

namespace {

bool parse_port(const char* value, uint16_t& port) {
  unsigned int parsed = 0;
  const auto* end = value + std::char_traits<char>::length(value);
  const auto result = std::from_chars(value, end, parsed);
  if (result.ec != std::errc() || result.ptr != end || parsed == 0 || parsed > 65535) return false;
  port = static_cast<uint16_t>(parsed);
  return true;
}

int run_authenticated_server(uint16_t port, const std::filesystem::path& ui_directory, const std::string& verifier, const std::string& worker_url = {}, const std::string& credential_file = {}) {
  plugmesh::PluginManager plugins;
  std::string plugin_error;
  const auto plugin_directory = [&ui_directory] {
    if (const char* override = std::getenv("PLUGMESH_SMOKE_PLUGIN_DIRECTORY"); override && *override) return std::filesystem::path(override);
    return ui_directory.parent_path().parent_path() / "native-server" / "build" / "plugins";
  }();
  if (!plugins.discover(plugin_directory, plugin_error)) std::cerr << "local UI smoke plugin discovery failed: " << plugin_error << '\n';
  plugmesh::LocalHttpServer server(port, &plugins, [worker_url, credential_file] {
    return nlohmann::json{
        {"configured", true},
        {"connected", false},
        {"serverId", "smoke-server"},
        {"workerUrl", worker_url},
        {"credentialFile", credential_file},
        {"systemCredentialsAvailable", plugmesh::system_credentials_available()},
    };
  }, ui_directory, {}, [] { return nlohmann::json::array(); }, {}, verifier);
  std::string error;
  if (!server.run(error)) {
    if (!error.empty()) std::cerr << "local UI smoke server failed: " << error << '\n';
    return 1;
  }
  return 0;
}

int run_setup_server(uint16_t port, const std::filesystem::path& ui_directory) {
  std::atomic<bool> registration_complete{false};
  std::atomic<bool> server_failed{false};
  std::string verifier;
  std::string worker_url;
  std::string credential_file;
  std::string server_error;
  plugmesh::LocalHttpServer server(port, nullptr, [] {
    return nlohmann::json{
        {"configured", false},
        {"connected", false},
        {"credentialFile", "smoke-credentials.json"},
        {"systemCredentialsAvailable", false},
    };
  }, ui_directory, [&registration_complete, &verifier, &worker_url, &credential_file](const nlohmann::json& payload, std::string& error) {
    const auto text = [&](const char* key) {
      return payload.contains(key) && payload.at(key).is_string() ? payload.at(key).get<std::string>() : std::string();
    };
    worker_url = text("workerUrl");
    credential_file = text("credentialFile");
    const auto server_name = text("serverName");
    const auto registration_code = text("registrationCode");
    const auto password = text("localUiPassword");
    const auto password_confirmation = text("localUiPasswordConfirmation");
    const auto credential_password = text("credentialPassword");
    if (worker_url.empty() || server_name.empty() || registration_code.empty() || credential_file.empty() || credential_password.empty() || password.size() < 8 || password != password_confirmation) {
      error = "invalid smoke registration payload";
      return nlohmann::json::object();
    }
    if (!plugmesh::make_local_ui_password_verifier(password, verifier, error)) return nlohmann::json::object();
    registration_complete = true;
    return nlohmann::json{{"serverId", "smoke-server"}, {"credentialFile", credential_file}};
  });
  std::thread server_thread([&] {
    if (!server.run(server_error) && !registration_complete) server_failed = true;
  });
  while (!registration_complete && !server_failed) std::this_thread::sleep_for(std::chrono::milliseconds(10));
  if (registration_complete) std::this_thread::sleep_for(std::chrono::milliseconds(100));
  server.stop();
  if (server_thread.joinable()) server_thread.join();
  if (server_failed || verifier.empty()) {
    std::cerr << "local UI setup smoke server failed: " << server_error << '\n';
    return 1;
  }
  return run_authenticated_server(port, ui_directory, verifier, worker_url, credential_file);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 4) {
    std::cerr << "usage: plugmesh-local-ui-smoke-server <port> <ui-directory> <authenticated|setup>\n";
    return 2;
  }

  uint16_t port = 0;
  if (!parse_port(argv[1], port)) {
    std::cerr << "invalid smoke server port\n";
    return 2;
  }

  const std::filesystem::path ui_directory(argv[2]);
  if (!std::filesystem::is_directory(ui_directory)) {
    std::cerr << "native UI directory does not exist: " << ui_directory << '\n';
    return 2;
  }

  const std::string mode(argv[3]);
  if (mode == "setup") return run_setup_server(port, ui_directory);
  if (mode != "authenticated") {
    std::cerr << "invalid local UI smoke server mode\n";
    return 2;
  }
  std::string verifier;
  std::string error;
  if (!plugmesh::make_local_ui_password_verifier("smoke-password", verifier, error)) {
    std::cerr << "password verifier setup failed: " << error << '\n';
    return 1;
  }
  return run_authenticated_server(port, ui_directory, verifier);
}
