#include "plugmesh/plugin_host_protocol.h"
#include "plugmesh/plugin_loader.h"

#include <cstdlib>
#include <iostream>
#include <string>

namespace {

void emit(const plugmesh::HostJson& event) {
  std::cout << event.dump() << '\n' << std::flush;
}

void emit_log(int level, const char* message) {
  emit({{"event", "log"}, {"level", level}, {"message", message ? message : ""}});
}

int host_stream_open(const char* stream_id, uint16_t status, const char* headers_json) {
  emit({{"event", "stream.open"}, {"streamId", stream_id ? stream_id : ""}, {"status", status}, {"headersJson", headers_json ? headers_json : "{}"}});
  return 0;
}

int host_stream_write(const char* stream_id, const uint8_t* data, uint64_t size, int finished) {
  emit({{"event", "stream.write"}, {"streamId", stream_id ? stream_id : ""}, {"data", plugmesh::base64_encode(data, size)}, {"finished", finished}});
  return 0;
}

int host_http_request(const plugmesh_http_request*, plugmesh_http_response*) { return -1; }

const plugmesh_host_api HOST_API = {
    PLUGMESH_PLUGIN_ABI_VERSION,
    emit_log,
    host_http_request,
    host_stream_open,
    host_stream_write,
};

plugmesh::HostJson response_body(const plugmesh_http_response& response) {
  return {
      {"status", response.status},
      {"headersJson", response.headers_json ? response.headers_json : "{}"},
      {"body", plugmesh::base64_encode(response.body.data, response.body.size)},
  };
}

bool read_request(const plugmesh::HostJson& message, std::string& method, std::string& path, std::string& headers, std::string& body, std::string& error) {
  if (!message.contains("request") || !message["request"].is_object()) {
    error = "request payload is missing";
    return false;
  }
  const auto& request = message["request"];
  method = request.value("method", std::string("GET"));
  path = request.value("path", std::string("/"));
  headers = request.value("headersJson", std::string("{}"));
  const std::string encoded = request.value("body", std::string());
  return plugmesh::base64_decode(encoded, body, error);
}

}  // namespace

int main(int argc, char** argv) {
  if (argc != 2) {
    std::cerr << "usage: plugmesh-plugin-host <plugin-library>" << '\n';
    return 2;
  }
  plugmesh::PluginLoader loader;
  std::string error;
  if (!loader.load(argv[1], error)) {
    emit({{"event", "fatal"}, {"error", error}});
    return 1;
  }
  const auto* v3 = loader.api_v3();
  const auto* api = loader.api();
  if (!api) {
    emit({{"event", "fatal"}, {"error", "plugin library has no ABI entry point"}});
    return 1;
  }
  emit({{"event", "ready"}, {"pluginId", api->plugin_id ? api->plugin_id : ""}, {"abiVersion", loader.abi_version()}});

  bool started = false;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    plugmesh::HostJson message;
    try {
      message = plugmesh::HostJson::parse(line);
    } catch (const plugmesh::HostJson::exception& exception) {
      emit({{"event", "fatal"}, {"error", std::string("invalid host request: ") + exception.what()}});
      return 1;
    }
    if (!message.is_object() || !message.contains("op") || !message["op"].is_string()) {
      emit({{"event", "fatal"}, {"error", "invalid host request"}});
      return 1;
    }
    const auto op = message["op"].get<std::string>();
    plugmesh::HostJson reply = {{"ok", true}};
    if (message.contains("id")) reply["id"] = message["id"];
    bool shutdown = false;

    if (op == "describe") {
      reply["pluginId"] = api->plugin_id ? api->plugin_id : "";
      reply["name"] = api->plugin_name ? api->plugin_name : "";
      reply["version"] = api->plugin_version ? api->plugin_version : "";
      reply["abiVersion"] = loader.abi_version();
      reply["capabilities"] = {
          {"http", api->handle_http != nullptr},
          {"websocket", api->handle_websocket != nullptr},
          {"sse", api->handle_sse != nullptr},
          {"fileStream", api->handle_file != nullptr},
          {"websocketOpen", v3 && v3->handle_websocket_open != nullptr},
      };
    } else if (op == "start") {
      if (api->start(&HOST_API) != 0) {
        reply = {{"ok", false}, {"error", "plugin start failed"}};
      } else {
        started = true;
      }
    } else if (op == "stop") {
      if (started && api->stop && api->stop() != 0) {
        reply = {{"ok", false}, {"error", "plugin stop failed"}};
      }
      started = false;
    } else if (op == "health") {
      plugmesh_http_response response{};
      if (!api->health || api->health(&response) != 0) {
        reply = {{"ok", false}, {"error", "plugin health check failed"}};
      } else {
        reply["response"] = response_body(response);
      }
    } else if (op == "http" || op == "sse" || op == "file") {
      std::string method;
      std::string path;
      std::string headers;
      std::string body;
      if (!read_request(message, method, path, headers, body, error)) {
        reply = {{"ok", false}, {"error", error}};
      } else {
        plugmesh_http_request request{method.c_str(), path.c_str(), headers.c_str(), reinterpret_cast<const uint8_t*>(body.data()), body.size()};
        const std::string stream_id = message.value("streamId", std::string());
        int result = -1;
        if (op == "http") {
          plugmesh_http_response response{};
          result = api->handle_http ? api->handle_http(&request, &response) : -1;
          if (result == 0) reply["response"] = response_body(response);
        } else if (op == "sse") {
          result = api->handle_sse ? api->handle_sse(stream_id.c_str(), &request) : -1;
        } else {
          result = api->handle_file ? api->handle_file(stream_id.c_str(), &request) : -1;
        }
        if (result != 0) reply = {{"ok", false}, {"error", "plugin " + op + " handler failed"}};
      }
    } else if (op == "websocket.open") {
      if (!v3 || !v3->handle_websocket_open) {
        reply = {{"ok", false}, {"error", "plugin ABI does not support websocket open"}};
      } else if (v3->handle_websocket_open(message.value("connectionId", std::string()).c_str(), message.value("path", std::string("/")).c_str(), message.value("headersJson", std::string("{}")).c_str()) != 0) {
        reply = {{"ok", false}, {"error", "plugin websocket open failed"}};
      }
    } else if (op == "websocket.data") {
      std::string data;
      if (!plugmesh::base64_decode(message.value("data", std::string()), data, error)) {
        reply = {{"ok", false}, {"error", error}};
      } else if (!api->handle_websocket || api->handle_websocket(message.value("connectionId", std::string()).c_str(), reinterpret_cast<const uint8_t*>(data.data()), data.size(), message.value("text", false) ? 1 : 0) != 0) {
        reply = {{"ok", false}, {"error", "plugin websocket handler failed"}};
      }
    } else if (op == "websocket.close") {
      if (!v3 || !v3->handle_websocket_close) {
        reply = {{"ok", false}, {"error", "plugin ABI does not support websocket close"}};
      } else if (v3->handle_websocket_close(message.value("connectionId", std::string()).c_str(), static_cast<uint16_t>(message.value("code", 1000)), message.value("reason", std::string()).c_str()) != 0) {
        reply = {{"ok", false}, {"error", "plugin websocket close failed"}};
      }
    } else if (op == "shutdown") {
      if (started && api->stop) api->stop();
      shutdown = true;
    } else {
      reply = {{"ok", false}, {"error", "unknown host operation: " + op}};
    }
    if (!reply.contains("id") && message.contains("id")) reply["id"] = message["id"];
    emit(reply);
    if (shutdown) break;
  }
  if (started && api->stop) api->stop();
  return 0;
}
