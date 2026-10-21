#include "plugmesh/plugin_host_protocol.h"

namespace plugmesh {

namespace {

constexpr char kAlphabet[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int decode_symbol(char value) {
  if (value >= 'A' && value <= 'Z') return value - 'A';
  if (value >= 'a' && value <= 'z') return value - 'a' + 26;
  if (value >= '0' && value <= '9') return value - '0' + 52;
  if (value == '+') return 62;
  if (value == '/') return 63;
  return -1;
}

}  // namespace

std::string base64_encode(const uint8_t* data, uint64_t size) {
  std::string output;
  output.reserve(static_cast<size_t>((size + 2) / 3 * 4));
  for (uint64_t offset = 0; offset < size; offset += 3) {
    const uint32_t first = data[offset];
    const uint32_t second = offset + 1 < size ? data[offset + 1] : 0;
    const uint32_t third = offset + 2 < size ? data[offset + 2] : 0;
    const uint32_t block = (first << 16) | (second << 8) | third;
    output.push_back(kAlphabet[(block >> 18) & 0x3f]);
    output.push_back(kAlphabet[(block >> 12) & 0x3f]);
    output.push_back(offset + 1 < size ? kAlphabet[(block >> 6) & 0x3f] : '=');
    output.push_back(offset + 2 < size ? kAlphabet[block & 0x3f] : '=');
  }
  return output;
}

std::string base64_encode(const std::string& data) {
  return base64_encode(reinterpret_cast<const uint8_t*>(data.data()), data.size());
}

bool base64_decode(const std::string& text, std::string& output, std::string& error) {
  if (text.size() % 4 != 0) {
    error = "base64 payload length is invalid";
    return false;
  }
  output.clear();
  output.reserve(text.size() / 4 * 3);
  for (size_t offset = 0; offset < text.size(); offset += 4) {
    int values[4] = {0, 0, 0, 0};
    for (int index = 0; index < 4; ++index) {
      const char symbol = text[offset + static_cast<size_t>(index)];
      if (symbol == '=' && offset + 4 == text.size() && index >= 2) {
        values[index] = -1;
        continue;
      }
      values[index] = decode_symbol(symbol);
      if (values[index] < 0) {
        error = "base64 payload contains an invalid character";
        return false;
      }
    }
    const uint32_t block = (static_cast<uint32_t>(values[0]) << 18) | (static_cast<uint32_t>(values[1]) << 12) |
                           (static_cast<uint32_t>(values[2] < 0 ? 0 : values[2]) << 6) | static_cast<uint32_t>(values[3] < 0 ? 0 : values[3]);
    output.push_back(static_cast<char>((block >> 16) & 0xff));
    if (values[2] >= 0) output.push_back(static_cast<char>((block >> 8) & 0xff));
    if (values[3] >= 0) output.push_back(static_cast<char>(block & 0xff));
  }
  return true;
}

}  // namespace plugmesh
