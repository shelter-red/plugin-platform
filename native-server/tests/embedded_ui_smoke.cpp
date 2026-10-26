#include "plugmesh/embedded_ui.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

int main() {
  const auto unique = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto root = std::filesystem::temp_directory_path() / ("plugmesh-embedded-ui-smoke-" + std::to_string(unique));
  const auto output = root / "native-ui" / "dist";
  std::string error;
  if (!plugmesh::extract_embedded_ui(output, error)) {
    std::cerr << "embedded UI extraction failed: " << error << '\n';
    return 1;
  }

  const auto index = output / "index.html";
  std::ifstream first(index, std::ios::binary);
  const std::string embedded((std::istreambuf_iterator<char>(first)), std::istreambuf_iterator<char>());
  first.close();
  if (embedded.empty() || embedded.find("<!doctype html>") == std::string::npos || embedded.find("assets/") == std::string::npos) {
    std::cerr << "extracted index.html does not reference the embedded assets\n";
    std::filesystem::remove_all(root);
    return 1;
  }

  {
    std::ofstream modified(index, std::ios::binary | std::ios::trunc);
    modified << "stale-ui";
  }
  {
    std::ofstream stale(output / "stale.txt");
    stale << "stale";
  }
#if !defined(_WIN32)
  const auto outside_marker = root / "outside" / "sentinel.txt";
  std::filesystem::create_directories(outside_marker.parent_path());
  {
    std::ofstream marker(outside_marker, std::ios::binary);
    marker << "untouched";
  }
  std::filesystem::remove_all(output / "assets");
  std::filesystem::create_directory_symlink(outside_marker.parent_path(), output / "assets");
#endif
  if (!plugmesh::extract_embedded_ui(output, error)) {
    std::cerr << "embedded UI overwrite failed: " << error << '\n';
    std::filesystem::remove_all(root);
    return 1;
  }

  std::ifstream replaced(index, std::ios::binary);
  const std::string restored((std::istreambuf_iterator<char>(replaced)), std::istreambuf_iterator<char>());
  replaced.close();
#if !defined(_WIN32)
  std::ifstream marker(outside_marker, std::ios::binary);
  const std::string outside_content((std::istreambuf_iterator<char>(marker)), std::istreambuf_iterator<char>());
  marker.close();
  const bool safe_overwrite = outside_content == "untouched" && !std::filesystem::is_symlink(std::filesystem::symlink_status(output / "assets"));
#else
  const bool safe_overwrite = true;
#endif
  const bool passed = restored == embedded && !std::filesystem::exists(output / "stale.txt") && safe_overwrite;
  std::filesystem::remove_all(root);
  if (!passed) {
    std::cerr << "embedded UI overwrite did not restore assets or remove stale files\n";
    return 1;
  }
  std::cout << "embedded UI extraction and overwrite passed\n";
  return 0;
}
