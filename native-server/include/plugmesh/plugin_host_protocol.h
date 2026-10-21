#pragma once

#include <cstdint>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

using HostJson = nlohmann::json;

// Plugin host 协议使用逐行 JSON：父进程写入请求行，子进程按顺序写回事件行与
// 最终响应行。二进制载荷统一使用 base64，避免 JSON 字符串转义破坏数据。
std::string base64_encode(const uint8_t* data, uint64_t size);
std::string base64_encode(const std::string& data);
bool base64_decode(const std::string& text, std::string& output, std::string& error);

}  // namespace plugmesh
