#pragma once

#include <chrono>
#include <ctime>
#include <deque>
#include <iomanip>
#include <mutex>
#include <sstream>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

// 本地 UI「日志和基础诊断」的环形缓冲：保留最近 200 条，时间戳统一为 UTC ISO-8601。
class LocalLogBuffer {
 public:
  void append(int level, const char* message) {
    if (!message || !*message) return;
    std::lock_guard lock(mutex_);
    entries_.push_back({{"timestamp", timestamp()}, {"level", level}, {"message", message}});
    while (entries_.size() > 200) entries_.pop_front();
  }

  nlohmann::json snapshot() const {
    std::lock_guard lock(mutex_);
    nlohmann::json result = nlohmann::json::array();
    for (const auto& entry : entries_) result.push_back(entry);
    return result;
  }

 private:
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
};

}  // namespace plugmesh
