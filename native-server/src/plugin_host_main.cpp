#include "plugmesh/plugin_host_protocol.h"
#include "plugmesh/plugin_loader.h"

#include <atomic>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

std::mutex output_mutex;

void emit(const plugmesh::HostJson& event) {
  std::lock_guard lock(output_mutex);
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

struct SseJob {
  std::thread thread;
  std::atomic<bool> done{false};
};

class SseJobs {
 public:
  ~SseJobs() { shutdown(); }

  bool start(const std::string& stream_id, std::function<int()> handler) {
    if (stream_id.empty()) return false;
    auto job = std::make_shared<SseJob>();
    {
      std::lock_guard lock(mutex_);
      if (jobs_.find(stream_id) != jobs_.end()) return false;
      jobs_[stream_id] = job;
    }
    job->thread = std::thread([job, handler = std::move(handler)]() mutable {
      handler();
      job->done.store(true, std::memory_order_release);
    });
    return true;
  }

  std::shared_ptr<SseJob> find(const std::string& stream_id) {
    std::lock_guard lock(mutex_);
    const auto iterator = jobs_.find(stream_id);
    return iterator == jobs_.end() ? nullptr : iterator->second;
  }

  std::vector<std::string> active_stream_ids() {
    std::lock_guard lock(mutex_);
    std::vector<std::string> ids;
    ids.reserve(jobs_.size());
    for (const auto& [stream_id, job] : jobs_) {
      if (!job->done.load(std::memory_order_acquire)) ids.push_back(stream_id);
    }
    return ids;
  }

  void reap(bool wait_all) {
    for (;;) {
      std::vector<std::thread> completed;
      {
        std::lock_guard lock(mutex_);
        for (auto iterator = jobs_.begin(); iterator != jobs_.end();) {
          if (!wait_all && !iterator->second->done.load(std::memory_order_acquire)) {
            ++iterator;
            continue;
          }
          completed.push_back(std::move(iterator->second->thread));
          iterator = jobs_.erase(iterator);
        }
      }
      for (auto& thread : completed) {
        if (thread.joinable()) thread.join();
      }
      if (!wait_all) return;
      {
        std::lock_guard lock(mutex_);
        if (jobs_.empty()) return;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(2));
    }
  }

  void shutdown() {
    reap(true);
  }

 private:
  std::mutex mutex_;
  std::map<std::string, std::shared_ptr<SseJob>> jobs_;
};

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
  const auto* v4 = loader.api_v4();
  const auto* api = loader.api();
  if (!api) {
    emit({{"event", "fatal"}, {"error", "plugin library has no ABI entry point"}});
    return 1;
  }
  emit({{"event", "ready"}, {"pluginId", api->plugin_id ? api->plugin_id : ""}, {"abiVersion", loader.abi_version()}});

  bool started = false;
  SseJobs sse_jobs;
  const auto cancel_all_sse = [&] {
    if (!v4 || !v4->handle_sse_cancel) return;
    for (const auto& stream_id : sse_jobs.active_stream_ids()) v4->handle_sse_cancel(stream_id.c_str());
  };
  const auto stop_plugin = [&] {
    cancel_all_sse();
    sse_jobs.reap(true);
    if (started && api->stop) api->stop();
    started = false;
  };

  std::string line;
  int exit_code = 0;
  while (std::getline(std::cin, line)) {
    sse_jobs.reap(false);
    if (line.empty()) continue;
    plugmesh::HostJson message;
    try {
      message = plugmesh::HostJson::parse(line);
    } catch (const plugmesh::HostJson::exception& exception) {
      emit({{"event", "fatal"}, {"error", std::string("invalid host request: ") + exception.what()}});
      exit_code = 1;
      break;
    }
    if (!message.is_object() || !message.contains("op") || !message["op"].is_string()) {
      emit({{"event", "fatal"}, {"error", "invalid host request"}});
      exit_code = 1;
      break;
    }
    const auto op = message["op"].get<std::string>();
    plugmesh::HostJson reply = {{"ok", true}};
    const auto request_id = message.contains("id") ? message["id"] : plugmesh::HostJson();
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
          {"sseCancel", v4 && v4->handle_sse_cancel != nullptr},
      };
    } else if (op == "start") {
      if (api->start(&HOST_API) != 0) {
        reply = {{"ok", false}, {"error", "plugin start failed"}};
      } else {
        started = true;
      }
    } else if (op == "stop") {
      stop_plugin();
      reply = {{"ok", true}};
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
        if (op == "sse") {
          if (!message.contains("id") || !request_id.is_number_unsigned() || !api->handle_sse || !sse_jobs.start(stream_id, [&, request_id, method = std::move(method), path = std::move(path), headers = std::move(headers), body = std::move(body), stream_id]() mutable {
                plugmesh_http_request async_request{method.c_str(), path.c_str(), headers.c_str(), reinterpret_cast<const uint8_t*>(body.data()), body.size()};
                const int result = api->handle_sse ? api->handle_sse(stream_id.c_str(), &async_request) : -1;
                plugmesh::HostJson async_reply = {{"id", request_id}, {"ok", result == 0}};
                if (result != 0) async_reply["error"] = "plugin sse handler failed";
                emit(async_reply);
                return result;
              })) {
            reply = {{"ok", false}, {"error", stream_id.empty() ? "SSE stream id is empty" : "SSE stream is already active"}};
          } else {
            continue;
          }
        } else {
          int result = -1;
          if (op == "http") {
            plugmesh_http_response response{};
            result = api->handle_http ? api->handle_http(&request, &response) : -1;
            if (result == 0) reply["response"] = response_body(response);
          } else {
            result = api->handle_file ? api->handle_file(stream_id.c_str(), &request) : -1;
          }
          if (result != 0) reply = {{"ok", false}, {"error", "plugin " + op + " handler failed"}};
        }
      }
    } else if (op == "sse.cancel") {
      const auto stream_id = message.value("streamId", std::string());
      const auto job = sse_jobs.find(stream_id);
      if (!job) {
        reply = {{"ok", false}, {"error", "SSE stream is not active"}};
      } else if (!v4 || !v4->handle_sse_cancel) {
        reply = {{"ok", false}, {"error", "plugin ABI does not support SSE cancellation"}};
      } else if (v4->handle_sse_cancel(stream_id.c_str()) != 0) {
        reply = {{"ok", false}, {"error", "plugin SSE cancellation failed"}};
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
      stop_plugin();
      shutdown = true;
    } else {
      reply = {{"ok", false}, {"error", "unknown host operation: " + op}};
    }
    if (!reply.contains("id") && message.contains("id")) reply["id"] = message["id"];
    emit(reply);
    if (shutdown) break;
  }
  stop_plugin();
  return exit_code;
}
