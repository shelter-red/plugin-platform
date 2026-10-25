#pragma once

#include <cstdint>
#include <string>

namespace plugmesh::tunnel {

constexpr uint8_t kMagic = 0x50;
constexpr uint8_t kVersion = 1;
constexpr std::size_t kHeaderSize = 3;
constexpr uint8_t kData = 1;
constexpr uint8_t kFin = 2;
constexpr uint8_t kPasswordRequired = 16;
constexpr uint8_t kAuthenticate = 17;
constexpr uint8_t kAuthResult = 18;
constexpr uint8_t kReady = 19;
constexpr uint8_t kSessionId = 20;

inline std::string frame(uint8_t type, const std::string& payload = {}) {
  std::string value;
  value.reserve(kHeaderSize + payload.size());
  value.push_back(static_cast<char>(kMagic));
  value.push_back(static_cast<char>(kVersion));
  value.push_back(static_cast<char>(type));
  value.append(payload);
  return value;
}

inline bool parse(const std::string& value, uint8_t& type, std::string& payload) {
  if (value.size() < kHeaderSize || static_cast<uint8_t>(value[0]) != kMagic || static_cast<uint8_t>(value[1]) != kVersion) return false;
  type = static_cast<uint8_t>(value[2]);
  payload.assign(value.data() + kHeaderSize, value.size() - kHeaderSize);
  return true;
}

}  // namespace plugmesh::tunnel
