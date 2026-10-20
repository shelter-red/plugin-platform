#include "plugmesh/control_protocol.h"

#include <chrono>
#include <iomanip>
#include <random>
#include <sstream>

namespace plugmesh {

namespace {

std::string random_id() {
  std::random_device random;
  std::ostringstream output;
  output << std::hex << std::setfill('0');
  for (int index = 0; index < 16; ++index) output << std::setw(2) << (random() & 0xff);
  return output.str();
}

std::string timestamp() {
  const auto now = std::chrono::system_clock::now();
  const auto seconds = std::chrono::time_point_cast<std::chrono::seconds>(now);
  const auto milliseconds = std::chrono::duration_cast<std::chrono::milliseconds>(now - seconds).count();
  const std::time_t time = std::chrono::system_clock::to_time_t(seconds);
  std::tm utc{};
#ifdef _WIN32
  gmtime_s(&utc, &time);
#else
  gmtime_r(&time, &utc);
#endif
  std::ostringstream output;
  output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%S") << '.' << std::setw(3) << std::setfill('0') << milliseconds << 'Z';
  return output.str();
}

}  // namespace

bool parse_control_frame(const std::string& raw, ControlFrame& frame, std::string& error) {
  try {
    const auto value = Json::parse(raw);
    if (!value.is_object() || value.value("protocolVersion", 0u) != kProtocolVersion || !value.contains("type") || !value.contains("requestId") || !value.contains("serverId") || !value.contains("timestamp") || !value.contains("nonce")) {
      error = "control frame is missing required fields";
      return false;
    }
    frame.protocol_version = value.at("protocolVersion").get<uint32_t>();
    frame.type = value.at("type").get<std::string>();
    frame.request_id = value.at("requestId").get<std::string>();
    frame.server_id = value.at("serverId").get<std::string>();
    frame.plugin_id = value.value("pluginId", std::string());
    frame.timestamp = value.at("timestamp").get<std::string>();
    frame.nonce = value.at("nonce").get<std::string>();
    frame.payload = value.value("payload", Json::object());
    if (!frame.payload.is_object()) {
      error = "control frame payload must be an object";
      return false;
    }
    return true;
  } catch (const Json::exception& exception) {
    error = exception.what();
    return false;
  }
}

std::string serialize_control_frame(const ControlFrame& frame) {
  Json value = {
      {"protocolVersion", frame.protocol_version},
      {"type", frame.type},
      {"requestId", frame.request_id},
      {"serverId", frame.server_id},
      {"timestamp", frame.timestamp},
      {"nonce", frame.nonce},
      {"payload", frame.payload},
  };
  if (!frame.plugin_id.empty()) value["pluginId"] = frame.plugin_id;
  return value.dump();
}

ControlFrame make_control_frame(const std::string& type, const std::string& server_id, Json payload, const std::string& plugin_id) {
  ControlFrame frame;
  frame.type = type;
  frame.request_id = random_id();
  frame.server_id = server_id;
  frame.plugin_id = plugin_id;
  frame.timestamp = timestamp();
  frame.nonce = random_id();
  frame.payload = std::move(payload);
  return frame;
}

}  // namespace plugmesh
