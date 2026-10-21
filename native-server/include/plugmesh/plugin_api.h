#pragma once

#include <stdint.h>

#ifdef _WIN32
#define PLUGMESH_EXPORT __declspec(dllexport)
#else
#define PLUGMESH_EXPORT __attribute__((visibility("default")))
#endif

#define PLUGMESH_PLUGIN_ABI_VERSION 2u
#define PLUGMESH_PLUGIN_ABI_VERSION_V3 3u
#define PLUGMESH_PLUGIN_ABI_VERSION_V4 4u

#ifdef __cplusplus
extern "C" {
#endif

typedef struct plugmesh_buffer {
  const uint8_t* data;
  uint64_t size;
} plugmesh_buffer;

typedef struct plugmesh_http_request {
  const char* method;
  const char* path;
  const char* headers_json;
  const uint8_t* body;
  uint64_t body_size;
} plugmesh_http_request;

typedef struct plugmesh_http_response {
  uint16_t status;
  const char* headers_json;
  plugmesh_buffer body;
} plugmesh_http_response;

typedef struct plugmesh_host_api {
  uint32_t abi_version;
  void (*log)(int level, const char* message);
  int (*http_request)(const plugmesh_http_request*, plugmesh_http_response*);
  int (*stream_open)(const char* stream_id, uint16_t status, const char* headers_json);
  int (*stream_write)(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
} plugmesh_host_api;

typedef struct plugmesh_plugin_api_v2 {
  uint32_t abi_version;
  const char* plugin_id;
  const char* plugin_name;
  const char* plugin_version;
  int (*start)(const plugmesh_host_api* host);
  int (*stop)();
  int (*health)(plugmesh_http_response* response);
  int (*handle_http)(const plugmesh_http_request* request, plugmesh_http_response* response);
  int (*handle_websocket)(const char* connection_id, const uint8_t* data, uint64_t size, int is_text);
  int (*handle_sse)(const char* stream_id, const plugmesh_http_request* request);
  int (*handle_file)(const char* stream_id, const plugmesh_http_request* request);
} plugmesh_plugin_api_v2;

typedef const plugmesh_plugin_api_v2* (*plugmesh_plugin_get_api_v2_fn)();

typedef struct plugmesh_plugin_api_v3 {
  plugmesh_plugin_api_v2 base;
  int (*handle_websocket_open)(const char* connection_id, const char* path, const char* headers_json);
  int (*handle_websocket_close)(const char* connection_id, uint16_t code, const char* reason);
} plugmesh_plugin_api_v3;

typedef const plugmesh_plugin_api_v3* (*plugmesh_plugin_get_api_v3_fn)();

// v4 增加 SSE 取消回调。宿主会在 SSE 回调仍运行时并发调用该函数，
// 插件必须让 handle_sse 尽快观察到取消并返回；未实现的旧插件继续使用 v2/v3。
typedef struct plugmesh_plugin_api_v4 {
  plugmesh_plugin_api_v3 base;
  int (*handle_sse_cancel)(const char* stream_id);
} plugmesh_plugin_api_v4;

typedef const plugmesh_plugin_api_v4* (*plugmesh_plugin_get_api_v4_fn)();

#ifdef __cplusplus
}
#endif
