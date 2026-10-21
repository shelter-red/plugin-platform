#pragma once

#include <chrono>
#include <cstddef>
#include <cstdint>
#include <deque>
#include <string>
#include <unordered_set>
#include <utility>

#include <nlohmann/json.hpp>

namespace plugmesh {

using Json = nlohmann::json;

constexpr uint32_t kProtocolVersion = 1;
constexpr std::size_t kMaxControlFrameBytes = 64 * 1024;
constexpr std::size_t kMaxSeenControlNonces = 2048;
constexpr auto kControlFrameTimeWindow = std::chrono::minutes(5);

struct ControlFrame {
  uint32_t protocol_version = kProtocolVersion;
  std::string type;
  std::string request_id;
  std::string server_id;
  std::string plugin_id;
  std::string timestamp;
  std::string nonce;
  Json payload = Json::object();
};

class ControlFrameReplayGuard {
 public:
  bool accept(const ControlFrame& frame);

 private:
  std::deque<std::pair<std::string, std::chrono::steady_clock::time_point>> seen_nonces_;
  std::unordered_set<std::string> nonce_index_;
};

bool parse_control_frame(const std::string& raw, ControlFrame& frame, std::string& error);
std::string serialize_control_frame(const ControlFrame& frame);
ControlFrame make_control_frame(const std::string& type, const std::string& server_id, Json payload = Json::object(), const std::string& plugin_id = {});

}  // namespace plugmesh
