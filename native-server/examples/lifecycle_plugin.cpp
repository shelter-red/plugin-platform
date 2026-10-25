#include "plugmesh/plugin_api.h"

#include <string>

namespace {

const plugmesh_host_api* host = nullptr;

int start_plugin(const plugmesh_host_api* next_host) {
  host = next_host;
  return 0;
}

int stop_plugin() {
  host = nullptr;
  return 0;
}

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

int handle_websocket_open(const char* connection_id, const char* path, const char* headers_json) {
  if (!host || !host->log) return -1;
  const std::string message = std::string("websocket.open:") + connection_id + ":" + path + ":" + headers_json;
  host->log(1, message.c_str());
  return 0;
}

int handle_websocket_close(const char* connection_id, uint16_t code, const char* reason) {
  if (!host || !host->log) return -1;
  const std::string message = std::string("websocket.close:") + connection_id + ":" + std::to_string(code) + ":" + reason;
  host->log(1, message.c_str());
  return 0;
}

const plugmesh_plugin_api API = {
    PLUGMESH_PLUGIN_ABI_VERSION, "lifecycle.plugin", "Lifecycle Plugin", "0.1.0", start_plugin, stop_plugin, health_plugin, handle_http,
    handle_websocket_open,
    handle_websocket,
    handle_websocket_close,
    nullptr,
    nullptr,
    nullptr,
};

}  // namespace

extern "C" PLUGMESH_EXPORT const plugmesh_plugin_api* plugmesh_plugin_get_api() {
  return &API;
}
