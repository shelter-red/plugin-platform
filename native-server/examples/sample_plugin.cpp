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

const plugmesh_plugin_api_v1 API = {
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
};

}  // namespace

extern "C" PLUGMESH_EXPORT const plugmesh_plugin_api_v1* plugmesh_plugin_get_api_v1() {
  return &API;
}
