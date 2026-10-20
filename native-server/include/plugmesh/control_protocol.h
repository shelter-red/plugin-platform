#pragma once

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

using Json = nlohmann::json;

constexpr uint32_t kProtocolVersion = 1;

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

bool parse_control_frame(const std::string& raw, ControlFrame& frame, std::string& error);
std::string serialize_control_frame(const ControlFrame& frame);
ControlFrame make_control_frame(const std::string& type, const std::string& server_id, Json payload = Json::object(), const std::string& plugin_id = {});

}  // namespace plugmesh
