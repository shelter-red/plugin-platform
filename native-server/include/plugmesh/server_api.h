#pragma once

#include <stddef.h>
#include <stdint.h>

#if defined(_WIN32)
#define PLUGMESH_SERVER_API __declspec(dllexport)
#elif defined(__GNUC__) || defined(__clang__)
#define PLUGMESH_SERVER_API __attribute__((visibility("default")))
#else
#define PLUGMESH_SERVER_API
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct plugmesh_server plugmesh_server;

/*
 * A pre-registered server configuration for the embeddable shared library.
 * The pointed-to strings are copied by plugmesh_server_create().
 */
typedef struct plugmesh_server_config {
  const char* worker_url;
  const char* server_id;
  const char* access_token;
  const char* plugin_directory;
  const char* plugin_host_executable;
} plugmesh_server_config;

/*
 * Creates a stopped server. Errors are copied into error_buffer when supplied;
 * the buffer is always NUL terminated when error_capacity is non-zero.
 */
PLUGMESH_SERVER_API plugmesh_server* plugmesh_server_create(const plugmesh_server_config* config, char* error_buffer, size_t error_capacity);
PLUGMESH_SERVER_API int plugmesh_server_start(plugmesh_server* server);
PLUGMESH_SERVER_API void plugmesh_server_stop(plugmesh_server* server);
PLUGMESH_SERVER_API void plugmesh_server_destroy(plugmesh_server* server);
PLUGMESH_SERVER_API int plugmesh_server_is_running(const plugmesh_server* server);

/* The returned pointer is owned by the server and remains valid until the next API call. */
PLUGMESH_SERVER_API const char* plugmesh_server_last_error(const plugmesh_server* server);

#ifdef __cplusplus
}
#endif
