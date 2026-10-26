#include "embedded_ui_internal.h"

#include <chrono>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

int main() {
  const auto unique = std::chrono::steady_clock::now().time_since_epoch().count();
  const auto root = std::filesystem::temp_directory_path() / ("plugmesh-safe-write-smoke-" + std::to_string(unique));
  const auto staging = root / "staging";
  const auto outside = root / "outside";
  std::filesystem::create_directories(staging);
  std::filesystem::create_directories(outside);

  const auto sentinel = outside / "sentinel.txt";
  {
    std::ofstream marker(sentinel, std::ios::binary);
    marker << "untouched";
  }
  std::error_code link_error;
  std::filesystem::create_directory_symlink(outside, staging / "assets", link_error);
  if (link_error) {
#if defined(_WIN32)
    std::filesystem::remove_all(root);
    std::cout << "directory symlink creation is unavailable; Windows reparse test skipped\n";
    return 0;
#else
    std::cerr << "unable to create symlink fixture: " << link_error.message() << '\n';
    std::filesystem::remove_all(root);
    return 1;
#endif
  }

  std::string error;
  const bool wrote = plugmesh::detail::write_asset_no_follow(staging, "assets/payload.txt", "injected", error);
  std::ifstream marker(sentinel, std::ios::binary);
  const std::string sentinel_contents((std::istreambuf_iterator<char>(marker)), std::istreambuf_iterator<char>());
  marker.close();
  const bool escaped = std::filesystem::exists(outside / "payload.txt");
  std::filesystem::remove_all(root);
  if (wrote || escaped || sentinel_contents != "untouched") {
    std::cerr << "no-follow asset writer escaped the staging directory";
    if (!error.empty()) std::cerr << ": " << error;
    std::cerr << '\n';
    return 1;
  }
  std::cout << "no-follow asset writer rejected directory symlinks\n";
  return 0;
}
