#include "plugmesh/plugin_api.h"

namespace {

const plugmesh_host_api* host = nullptr;

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

int handle_http(const plugmesh_http_request*, plugmesh_http_response* response) { return health_plugin(response); }
int handle_websocket(const char* connection_id, const uint8_t* data, uint64_t size, int) {
  return host && host->stream_write ? host->stream_write(connection_id, data, size, 0) : -1;
}

int handle_sse(const char* stream_id, const plugmesh_http_request*) {
  static const uint8_t event[] = "data: sample-plugin\n\n";
  return host && host->stream_write ? host->stream_write(stream_id, event, sizeof(event) - 1, 1) : -1;
}

int handle_file(const char* stream_id, const plugmesh_http_request*) {
  static const uint8_t body[] = "sample-file-stream";
  if (!host || !host->stream_open || !host->stream_write) return -1;
  if (host->stream_open(stream_id, 200, "{\"content-type\":\"application/octet-stream\"}") != 0) return -1;
  return host->stream_write(stream_id, body, sizeof(body) - 1, 1);
}

const plugmesh_plugin_api_v2 API = {
    PLUGMESH_PLUGIN_ABI_VERSION,
    "sample.plugin",
    "Sample Plugin",
    "0.1.0",
    start_plugin,
    stop_plugin,
    health_plugin,
    handle_http,
    handle_websocket,
    handle_sse,
    handle_file,
};

}  // namespace

extern "C" PLUGMESH_EXPORT const plugmesh_plugin_api_v2* plugmesh_plugin_get_api_v2() {
  return &API;
}
