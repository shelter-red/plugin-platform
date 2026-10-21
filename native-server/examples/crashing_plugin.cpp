#include "plugmesh/plugin_api.h"

namespace {

int start_plugin(const plugmesh_host_api*) { return 0; }
int stop_plugin() { return 0; }

int health_plugin(plugmesh_http_response* response) {
  static const uint8_t body[] = "ok";
  response->status = 200;
  response->headers_json = "{}";
  response->body = {body, sizeof(body) - 1};
  return 0;
}

// 故意解引用空指针，用于验证插件崩溃只终止宿主进程。
int handle_http(const plugmesh_http_request*, plugmesh_http_response*) {
  volatile int* pointer = nullptr;
  *pointer = 1;
  return 0;
}

const plugmesh_plugin_api_v2 API = {
    PLUGMESH_PLUGIN_ABI_VERSION,
    "crashing.plugin",
    "Crashing Plugin",
    "0.1.0",
    start_plugin,
    stop_plugin,
    health_plugin,
    handle_http,
    nullptr,
    nullptr,
    nullptr,
};

}  // namespace

extern "C" PLUGMESH_EXPORT const plugmesh_plugin_api_v2* plugmesh_plugin_get_api_v2() {
  return &API;
}
