#include "plugmesh/credential_store.h"
#include "plugmesh/local_http_server.h"

#include <charconv>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <string>

namespace {

bool parse_port(const char* value, uint16_t& port) {
  unsigned int parsed = 0;
  const auto* end = value + std::char_traits<char>::length(value);
  const auto result = std::from_chars(value, end, parsed);
  if (result.ec != std::errc() || result.ptr != end || parsed == 0 || parsed > 65535) return false;
  port = static_cast<uint16_t>(parsed);
  return true;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 3) {
    std::cerr << "usage: plugmesh-local-ui-smoke-server <port> <ui-directory>\n";
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

  std::string verifier;
  std::string error;
  if (!plugmesh::make_local_ui_password_verifier("smoke-password", verifier, error)) {
    std::cerr << "password verifier setup failed: " << error << '\n';
    return 1;
  }

  plugmesh::LocalHttpServer server(port, nullptr, [] {
    return nlohmann::json{
        {"configured", true},
        {"connected", false},
        {"systemCredentialsAvailable", plugmesh::system_credentials_available()},
    };
  }, ui_directory, {}, [] { return nlohmann::json::array(); }, {}, verifier);
  if (!server.run(error)) {
    if (!error.empty()) std::cerr << "local UI smoke server failed: " << error << '\n';
    return 1;
  }
  return 0;
}
