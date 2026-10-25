#pragma once

#include <chrono>
#include <ctime>
#include <deque>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

// 本地 UI「日志和基础诊断」的环形缓冲：保留最近 200 条，时间戳统一为 UTC ISO-8601。
class LocalLogBuffer {
 public:
  explicit LocalLogBuffer(std::filesystem::path file = {}) : file_(std::move(file)) {
    if (file_.empty()) return;
    std::ifstream input(file_);
    std::string line;
    while (std::getline(input, line)) {
      try {
        const auto entry = nlohmann::json::parse(line);
        if (entry.is_object() && entry.contains("timestamp") && entry.contains("level") && entry.contains("message")) entries_.push_back(entry);
      } catch (const nlohmann::json::exception&) {
      }
    }
    while (entries_.size() > 200) entries_.pop_front();
  }

  void append(int level, const char* message) {
    append_entry(level, message, false);
  }

  void append_communication(int level, const char* message) {
    append_entry(level, message, true);
  }

  nlohmann::json snapshot() const {
    std::lock_guard lock(mutex_);
    nlohmann::json result = nlohmann::json::array();
    for (const auto& entry : entries_) result.push_back(entry);
    return result;
  }

 private:
  void append_entry(int level, const char* message, bool persist_to_disk) {
    if (!message || !*message) return;
    std::lock_guard lock(mutex_);
    const nlohmann::json entry{{"timestamp", timestamp()}, {"level", level}, {"message", message}};
    entries_.push_back(entry);
    while (entries_.size() > 200) entries_.pop_front();
    if (persist_to_disk) persist(entry);
  }

  void persist(const nlohmann::json& entry) {
    if (file_.empty()) return;
    std::error_code error;
    if (!file_.parent_path().empty()) {
      std::filesystem::create_directories(file_.parent_path(), error);
      if (error) return;
    }
    constexpr uintmax_t max_file_size = 1024 * 1024;
    const auto size = std::filesystem::file_size(file_, error);
    if (!error && size >= max_file_size) {
      std::filesystem::remove(file_.string() + ".3", error);
      error.clear();
      for (int index = 2; index >= 1; --index) {
        const auto source = file_.string() + "." + std::to_string(index);
        const auto target = file_.string() + "." + std::to_string(index + 1);
        if (std::filesystem::exists(source, error)) {
          error.clear();
          std::filesystem::rename(source, target, error);
          if (error) return;
        }
      }
      error.clear();
      if (std::filesystem::exists(file_, error)) {
        error.clear();
        std::filesystem::rename(file_, file_.string() + ".1", error);
        if (error) return;
      }
    }
    std::ofstream output(file_, std::ios::binary | std::ios::app);
    if (!output) return;
    output << entry.dump() << '\n';
    output.close();
#ifndef _WIN32
    error.clear();
    std::filesystem::permissions(file_, std::filesystem::perms::owner_read | std::filesystem::perms::owner_write, std::filesystem::perm_options::replace, error);
#endif
  }

  static std::string timestamp() {
    const auto now = std::chrono::system_clock::to_time_t(std::chrono::system_clock::now());
    std::tm utc{};
#ifdef _WIN32
    gmtime_s(&utc, &now);
#else
    gmtime_r(&now, &utc);
#endif
    std::ostringstream output;
    output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
    return output.str();
  }

  mutable std::mutex mutex_;
  std::deque<nlohmann::json> entries_;
  std::filesystem::path file_;
};

}  // namespace plugmesh
