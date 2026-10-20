#include "plugmesh/credential_store.h"

#include <filesystem>
#include <fstream>
#include <iostream>

int main() {
  const auto path = std::filesystem::temp_directory_path() / "plugmesh-credential-store-smoke.json";
  std::error_code ignored;
  std::filesystem::remove(path, ignored);
  std::string error;
  std::string verifier;
  if (!plugmesh::make_local_ui_password_verifier("local-ui-password", verifier, error)) {
    std::cerr << "verifier creation failed: " << error << '\n';
    return 1;
  }
  if (!plugmesh::verify_local_ui_password("local-ui-password", verifier) || plugmesh::verify_local_ui_password("wrong-password", verifier)) {
    std::cerr << "password verifier comparison failed\n";
    return 2;
  }
  if (verifier.find("local-ui-password") != std::string::npos) {
    std::cerr << "local UI password is stored in verifier\n";
    return 3;
  }
  const plugmesh::StoredCredentials expected{"https://worker.example", "server-1", "access-token", verifier};
  if (!plugmesh::save_credentials(path, expected, "correct-password", error)) {
    std::cerr << "save failed: " << error << '\n';
    return 4;
  }
  std::ifstream raw(path);
  const std::string encoded((std::istreambuf_iterator<char>(raw)), std::istreambuf_iterator<char>());
  if (encoded.find(expected.access_token) != std::string::npos) {
    std::cerr << "credential token is stored in plaintext\n";
    return 5;
  }
  plugmesh::StoredCredentials actual;
  if (!plugmesh::load_credentials(path, "correct-password", actual, error) || actual.worker_url != expected.worker_url || actual.server_id != expected.server_id || actual.access_token != expected.access_token || actual.local_ui_password_verifier != expected.local_ui_password_verifier) {
    std::cerr << "round-trip failed: " << error << '\n';
    return 6;
  }
  if (plugmesh::load_credentials(path, "wrong-password", actual, error)) {
    std::cerr << "wrong password was accepted\n";
    return 7;
  }
  std::ofstream corrupted(path, std::ios::trunc);
  corrupted << "{}";
  corrupted.close();
  if (plugmesh::load_credentials(path, "correct-password", actual, error)) {
    std::cerr << "corrupted file was accepted\n";
    return 8;
  }
  if (!plugmesh::save_credentials(path, expected, "correct-password", error) || !plugmesh::remove_credentials(path, error) || std::filesystem::exists(path)) {
    std::cerr << "credential removal failed: " << error << '\n';
    return 9;
  }
  if (!plugmesh::system_credentials_available()) {
    if (plugmesh::save_system_credentials(expected, error) || plugmesh::load_system_credentials(actual, error)) {
      std::cerr << "unavailable system credential store was reported as usable\n";
      return 10;
    }
  }
  std::filesystem::remove(path, ignored);
  std::cout << "credential store smoke test passed\n";
  return 0;
}
