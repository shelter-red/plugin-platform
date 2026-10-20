#pragma once

#include <stdint.h>

#ifdef _WIN32
#define PLUGMESH_EXPORT __declspec(dllexport)
#else
#define PLUGMESH_EXPORT __attribute__((visibility("default")))
#endif

#define PLUGMESH_PLUGIN_ABI_VERSION 1u

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
  int (*stream_write)(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
} plugmesh_host_api;

typedef struct plugmesh_plugin_api_v1 {
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
} plugmesh_plugin_api_v1;

typedef const plugmesh_plugin_api_v1* (*plugmesh_plugin_get_api_v1_fn)();

#ifdef __cplusplus
}
#endif
