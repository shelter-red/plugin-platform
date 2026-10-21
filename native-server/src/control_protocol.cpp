#include "plugmesh/control_protocol.h"

#include <chrono>
#include <cctype>
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

constexpr bool leap_year(int year) {
  return year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
}

bool parse_number(const std::string& value, std::size_t offset, std::size_t length, int& result) {
  result = 0;
  for (std::size_t index = offset; index < offset + length; ++index) {
    const auto character = static_cast<unsigned char>(value[index]);
    if (!std::isdigit(character)) return false;
    result = result * 10 + (character - '0');
  }
  return true;
}

constexpr int64_t days_from_civil(int year, unsigned month, unsigned day) {
  year -= month <= 2;
  const int era = (year >= 0 ? year : year - 399) / 400;
  const auto year_of_era = static_cast<unsigned>(year - era * 400);
  const auto adjusted_month = static_cast<unsigned>(static_cast<int>(month) + (month > 2 ? -3 : 9));
  const auto day_of_year = (153 * adjusted_month + 2) / 5 + day - 1;
  const auto day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
  return static_cast<int64_t>(era) * 146097 + static_cast<int64_t>(day_of_era) - 719468;
}

bool parse_timestamp(const std::string& value, int64_t& result) {
  if (value.size() != 24 || value[4] != '-' || value[7] != '-' || value[10] != 'T' || value[13] != ':' || value[16] != ':' || value[19] != '.' || value[23] != 'Z') return false;
  int year = 0;
  int month = 0;
  int day = 0;
  int hour = 0;
  int minute = 0;
  int second = 0;
  int millisecond = 0;
  if (!parse_number(value, 0, 4, year) || !parse_number(value, 5, 2, month) || !parse_number(value, 8, 2, day) || !parse_number(value, 11, 2, hour) || !parse_number(value, 14, 2, minute) || !parse_number(value, 17, 2, second) || !parse_number(value, 20, 3, millisecond)) return false;
  constexpr int days_per_month[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const int max_day = days_per_month[month - 1] + (month == 2 && leap_year(year) ? 1 : 0);
  if (day > max_day) return false;
  const auto epoch_seconds = days_from_civil(year, static_cast<unsigned>(month), static_cast<unsigned>(day)) * 86400 + hour * 3600 + minute * 60 + second;
  result = epoch_seconds * 1000 + millisecond;
  return true;
}

}  // namespace

bool ControlFrameReplayGuard::accept(const ControlFrame& frame) {
  if (frame.nonce.empty()) return false;
  int64_t frame_time = 0;
  if (!parse_timestamp(frame.timestamp, frame_time)) return false;
  const auto now = std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count();
  const auto difference = frame_time > now ? frame_time - now : now - frame_time;
  if (difference > std::chrono::duration_cast<std::chrono::milliseconds>(kControlFrameTimeWindow).count()) return false;

  const auto steady_now = std::chrono::steady_clock::now();
  while (!seen_nonces_.empty() && steady_now - seen_nonces_.front().second > kControlFrameTimeWindow) {
    nonce_index_.erase(seen_nonces_.front().first);
    seen_nonces_.pop_front();
  }
  if (nonce_index_.contains(frame.nonce)) return false;
  nonce_index_.insert(frame.nonce);
  seen_nonces_.emplace_back(frame.nonce, steady_now);
  while (seen_nonces_.size() > kMaxSeenControlNonces) {
    nonce_index_.erase(seen_nonces_.front().first);
    seen_nonces_.pop_front();
  }
  return true;
}

bool parse_control_frame(const std::string& raw, ControlFrame& frame, std::string& error) {
  if (raw.size() > kMaxControlFrameBytes) {
    error = "control frame is too large";
    return false;
  }
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
