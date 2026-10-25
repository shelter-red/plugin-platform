#include <cstdint>
#include <cstring>
#include <string>
#include <vector>

#include "plugmesh/plugin_api.h"

namespace {

const plugmesh_host_api* host = nullptr;
// /large 用于验收经 R2 中转的大文件路径：8 MiB 超过 Durable Object 的 1 MiB 内存缓冲阈值。
constexpr uint64_t kLargeFileBytes = 8ull * 1024 * 1024;
// 单帧上限 64 KiB，32 KiB 原始数据经 base64 后仍在限制内。
constexpr uint64_t kLargeChunkBytes = 32ull * 1024;

int start_plugin(const plugmesh_host_api* next_host) {
  host = next_host;
  return 0;
}
int stop_plugin() { return 0; }

int health_plugin(plugmesh_http_response* response) {
  static const uint8_t body[] = "ok";
  response->status = 200;
  response->headers_json = "{}";
  response->body = {body, sizeof(body) - 1};
  return 0;
}

int handle_http(const plugmesh_http_request* request, plugmesh_http_response* response) {
  static const uint8_t cookie_body[] = "cookie-set";
  if (request && request->path) {
    // /cookie 返回多条 Set-Cookie，供真实浏览器验收确认 Worker 原样透传重复响应头。
    if (std::strcmp(request->path, "/cookie") == 0) {
      static const char headers[] = "{\"content-type\":\"text/plain; charset=utf-8\",\"set-cookie\":[\"plugmesh_e2e=1; Path=/\",\"plugmesh_second=2; Path=/\"]}";
      response->status = 200;
      response->headers_json = headers;
      response->body = {cookie_body, sizeof(cookie_body) - 1};
      return 0;
    }
    // /headers 原样回显 Worker 转发的请求头 JSON，用于验证 Cookie 等头部确实到达插件。
    if (std::strcmp(request->path, "/headers") == 0 && request->headers_json) {
      static const char headers[] = "{\"content-type\":\"application/json\"}";
      response->status = 200;
      response->headers_json = headers;
      response->body = {reinterpret_cast<const uint8_t*>(request->headers_json), std::strlen(request->headers_json)};
      return 0;
    }
  }
  return health_plugin(response);
}
int handle_websocket(const char* connection_id, const uint8_t* data, uint64_t size, int) {
  return host && host->stream_write ? host->stream_write(connection_id, data, size, 0) : -1;
}

int handle_sse(const char* stream_id, const plugmesh_http_request*) {
  static const uint8_t event[] = "data: sample-plugin\n\n";
  return host && host->stream_write ? host->stream_write(stream_id, event, sizeof(event) - 1, 1) : -1;
}

int stream_large_file(const char* stream_id) {
  const std::string headers = "{\"content-type\":\"application/octet-stream\",\"content-length\":\"" + std::to_string(kLargeFileBytes) + "\"}";
  if (host->stream_open(stream_id, 200, headers.c_str()) != 0) return -1;
  std::vector<uint8_t> chunk(kLargeChunkBytes);
  for (uint64_t offset = 0; offset < kLargeFileBytes; offset += kLargeChunkBytes) {
    for (uint64_t index = 0; index < kLargeChunkBytes; ++index) chunk[index] = static_cast<uint8_t>((offset + index) % 251);
    const int finished = offset + kLargeChunkBytes >= kLargeFileBytes ? 1 : 0;
    if (host->stream_write(stream_id, chunk.data(), kLargeChunkBytes, finished) != 0) return -1;
  }
  return 0;
}

int handle_file(const char* stream_id, const plugmesh_http_request* request) {
  static const uint8_t body[] = "sample-file-stream";
  if (!host || !host->stream_open || !host->stream_write) return -1;
  if (request && request->path && std::strcmp(request->path, "/large") == 0) return stream_large_file(stream_id);
  if (host->stream_open(stream_id, 200, "{\"content-type\":\"application/octet-stream\"}") != 0) return -1;
  return host->stream_write(stream_id, body, sizeof(body) - 1, 1);
}

const plugmesh_plugin_api API = {
    PLUGMESH_PLUGIN_ABI_VERSION,
    "sample.plugin",
    "Sample Plugin",
    "0.1.0",
    start_plugin,
    stop_plugin,
    health_plugin,
    handle_http,
    nullptr,
    handle_websocket,
    nullptr,
    handle_sse,
    nullptr,
    handle_file,
};

}  // namespace

extern "C" PLUGMESH_EXPORT const plugmesh_plugin_api* plugmesh_plugin_get_api() {
  return &API;
}
