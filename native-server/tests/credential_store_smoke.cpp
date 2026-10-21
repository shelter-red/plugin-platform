#include "plugmesh/credential_store.h"

#include <cstdlib>
#include <cstring>
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
  std::string encoded;
  {
    // Windows 不允许删除仍被打开的文件，读取后立即关闭。
    std::ifstream raw(path);
    encoded.assign(std::istreambuf_iterator<char>(raw), std::istreambuf_iterator<char>());
  }
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
  const auto* system_test = std::getenv("PLUGMESH_TEST_SYSTEM_CREDENTIALS");
  const bool require_system_store = system_test && std::strcmp(system_test, "required") == 0;
  const bool system_store_available = plugmesh::system_credentials_available();
  if (require_system_store && !system_store_available) {
    std::cerr << "required system credential store is unavailable\n";
    return 10;
  }
  if (!system_store_available) {
    if (plugmesh::save_system_credentials(expected, error) || plugmesh::load_system_credentials(actual, error)) {
      std::cerr << "unavailable system credential store was reported as usable\n";
      return 11;
    }
  } else if (require_system_store) {
    if (!plugmesh::save_system_credentials(expected, error)) {
      std::cerr << "system credential save failed: " << error << '\n';
      return 12;
    }
    if (!plugmesh::load_system_credentials(actual, error) || actual.worker_url != expected.worker_url || actual.server_id != expected.server_id || actual.access_token != expected.access_token || actual.local_ui_password_verifier != expected.local_ui_password_verifier) {
      std::cerr << "system credential round-trip failed: " << error << '\n';
      return 13;
    }
    const plugmesh::StoredCredentials updated{"https://updated.example", "server-2", "updated-token", verifier};
    if (!plugmesh::save_system_credentials(updated, error) || !plugmesh::load_system_credentials(actual, error) || actual.worker_url != updated.worker_url || actual.server_id != updated.server_id || actual.access_token != updated.access_token) {
      std::cerr << "system credential update failed: " << error << '\n';
      return 14;
    }
    if (!plugmesh::remove_system_credentials(error) || plugmesh::load_system_credentials(actual, error)) {
      std::cerr << "system credential removal failed: " << error << '\n';
      return 15;
    }
  }
  std::filesystem::remove(path, ignored);
  std::cout << "credential store smoke test passed\n";
  return 0;
}
