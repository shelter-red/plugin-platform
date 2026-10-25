#pragma once

#include <stdint.h>

#ifdef _WIN32
#define PLUGMESH_EXPORT __declspec(dllexport)
#else
#define PLUGMESH_EXPORT __attribute__((visibility("default")))
#endif

// 插件与宿主之间使用唯一的 C ABI；当前版本不加载旧版或其他 ABI 版本的插件。
#define PLUGMESH_PLUGIN_ABI_VERSION 1u

#ifdef __cplusplus
extern "C" {
#endif

// 只读字节视图；data 不保证以 NUL 结尾，插件不得释放该指针。
typedef struct plugmesh_buffer {
  const uint8_t* data;
  uint64_t size;
} plugmesh_buffer;

// HTTP、SSE 和文件回调的请求视图；全部指针由宿主持有，仅在当前回调期间有效，异步使用前必须复制。
typedef struct plugmesh_http_request {
  // NUL 结尾的 HTTP 方法。
  const char* method;
  // NUL 结尾的 URL 路径。
  const char* path;
  // NUL 结尾的 JSON 对象文本，表示请求头。
  const char* headers_json;
  // 原始请求体字节；长度为 0 时可为空，不执行文本编码转换。
  const uint8_t* body;
  // body 的字节数。
  uint64_t body_size;
} plugmesh_http_request;

// 健康检查和 HTTP 回调的响应视图；宿主在回调返回后立即读取并复制响应内容。
typedef struct plugmesh_http_response {
  // HTTP 状态码。
  uint16_t status;
  // NUL 结尾的 JSON 对象文本，表示响应头。
  const char* headers_json;
  // 响应体字节；插件管理其存储，且须保持有效至宿主完成本次响应序列化。
  plugmesh_buffer body;
} plugmesh_http_response;

// start 收到的宿主能力表；函数指针在插件运行期间有效。
typedef struct plugmesh_host_api {
  // 固定为 PLUGMESH_PLUGIN_ABI_VERSION。
  uint32_t abi_version;
  // 写入本地服务器日志；message 为调用期间有效的 NUL 结尾字符串。
  void (*log)(int level, const char* message);
  // 当前本地插件宿主不支持主动 HTTP 请求，此函数返回非零值。
  int (*http_request)(const plugmesh_http_request* request, plugmesh_http_response* response);
  // 打开流式响应；headers_json 必须为 JSON 对象，stream_id 由宿主分配。
  int (*stream_open)(const char* stream_id, uint16_t status, const char* headers_json);
  // 写入流数据；data 在调用期间读取，finished 非零表示此流结束。
  int (*stream_write)(const char* stream_id, const uint8_t* data, uint64_t size, int finished);
} plugmesh_host_api;

// 唯一插件入口表。start、stop、health 必须提供；其他请求、生命周期和取消回调可为空指针。
// 字符串元数据和入口表须在动态库加载期间有效；所有回调返回 0 表示成功，非 0 表示失败。
typedef struct plugmesh_plugin_api {
  // 必须等于 PLUGMESH_PLUGIN_ABI_VERSION。
  uint32_t abi_version;
  // 必须与 manifest.json 的 id 一致；所有元数据字符串在动态库卸载前保持有效。
  const char* plugin_id;
  // 插件显示名称。
  const char* plugin_name;
  // 插件版本字符串。
  const char* plugin_version;
  // 启动插件；成功后 host 能力表可保存到 stop 完成。
  int (*start)(const plugmesh_host_api* host);
  // 停止插件并释放资源；宿主会先请求停止活动 SSE 流。
  int (*stop)(void);
  // 写入健康检查响应。
  int (*health)(plugmesh_http_response* response);
  // 处理一个 HTTP 请求并写入响应。
  int (*handle_http)(const plugmesh_http_request* request, plugmesh_http_response* response);
  // WebSocket 连接建立时调用；connection_id 在该连接生命周期内稳定。
  int (*handle_websocket_open)(const char* connection_id, const char* path, const char* headers_json);
  // 处理一帧 WebSocket 数据；is_text 非零表示文本帧，否则为二进制帧。
  int (*handle_websocket)(const char* connection_id, const uint8_t* data, uint64_t size, int is_text);
  // WebSocket 连接关闭时调用。
  int (*handle_websocket_close)(const char* connection_id, uint16_t code, const char* reason);
  // 处理 SSE 流；通过 host->stream_write 发送数据并标记完成。此回调在独立线程执行。
  int (*handle_sse)(const char* stream_id, const plugmesh_http_request* request);
  // 请求取消对应 SSE 流；可与 handle_sse 并发调用，插件负责同步共享状态并尽快返回。
  int (*handle_sse_cancel)(const char* stream_id);
  // 处理文件流；先用 stream_open 设置响应，再通过 stream_write 发送数据。
  int (*handle_file)(const char* stream_id, const plugmesh_http_request* request);
} plugmesh_plugin_api;

// 导出唯一符号 plugmesh_plugin_get_api，并返回静态入口表。
typedef const plugmesh_plugin_api* (*plugmesh_plugin_get_api_fn)(void);
PLUGMESH_EXPORT const plugmesh_plugin_api* plugmesh_plugin_get_api(void);

#ifdef __cplusplus
}
#endif
