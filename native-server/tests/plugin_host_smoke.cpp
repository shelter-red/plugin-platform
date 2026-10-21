#include "plugmesh/plugin_host_client.h"
#include "plugmesh/plugin_host_protocol.h"

#include <chrono>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {

int failures = 0;

void check(bool condition, const std::string& message) {
  if (condition) return;
  std::cerr << "FAIL: " << message << '\n';
  ++failures;
}

plugmesh::HostJson http_request(const std::string& path, const std::string& body = {}) {
  return {
      {"method", "GET"},
      {"path", path},
      {"headersJson", "{}"},
      {"body", plugmesh::base64_encode(body)},
  };
}

struct EventLog {
  void append(const plugmesh::HostJson& event) {
    std::lock_guard lock(mutex);
    events.push_back(event);
  }

  void clear() {
    std::lock_guard lock(mutex);
    events.clear();
  }

  std::vector<plugmesh::HostJson> snapshot() {
    std::lock_guard lock(mutex);
    return events;
  }

  bool wait_for_log(const std::string& message) {
    const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(3);
    while (std::chrono::steady_clock::now() < deadline) {
      for (const auto& event : snapshot()) {
        if (event.value("event", "") == "log" && event.value("message", "") == message) return true;
      }
      std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    return false;
  }

  std::mutex mutex;
  std::vector<plugmesh::HostJson> events;
};

}  // namespace

int main(int argc, char** argv) {
  if (argc != 5) {
    std::cerr << "usage: plugin-host-smoke <host> <sample-library> <crashing-library> <cancellable-library>\n";
    return 2;
  }
  const std::string host_executable = argv[1];
  const std::string sample_library = argv[2];
  const std::string crashing_library = argv[3];
  const std::string cancellable_library = argv[4];

  plugmesh::PluginHostClient client;
  EventLog events;
  client.set_event_handler([&events](const plugmesh::HostJson& event) { events.append(event); });

  std::string error;
  check(client.start(host_executable, sample_library, error), "plugin host starts: " + error);

  plugmesh::HostJson reply;
  check(client.request({{"op", "start"}}, reply, error), "plugin start: " + error);
  check(reply.value("ok", false), "plugin start reply is ok");

  auto snapshot = events.snapshot();
  check(!snapshot.empty() && snapshot.front().value("event", "") == "ready", "host announces ready");
  check(!snapshot.empty() && snapshot.front().value("pluginId", "") == "sample.plugin", "host reports plugin id");
  check(!snapshot.empty() && snapshot.front().value("abiVersion", 0) == 2, "host reports ABI v2 for legacy plugin");

  events.clear();
  check(client.request({{"op", "health"}}, reply, error), "plugin health: " + error);
  const auto health_body = reply["response"].value("body", std::string());
  std::string decoded;
  check(plugmesh::base64_decode(health_body, decoded, error) && decoded == "ok", "health body is ok");

  events.clear();
  check(client.request({{"op", "http"}, {"request", http_request("/hello")}}, reply, error), "plugin http: " + error);
  check(reply["response"].value("status", 0) == 200, "http status is 200");

  events.clear();
  check(client.request({{"op", "sse"}, {"streamId", "stream-1"}, {"request", http_request("/events")}}, reply, error), "plugin sse: " + error);
  snapshot = events.snapshot();
  check(snapshot.size() == 1 && snapshot[0].value("event", "") == "stream.write", "sse emits one stream write");
  check(plugmesh::base64_decode(snapshot[0].value("data", std::string()), decoded, error) && decoded == "data: sample-plugin\n\n", "sse payload matches");
  check(snapshot[0].value("finished", 0) == 1, "sse stream is finished");

  events.clear();
  check(client.request({{"op", "file"}, {"streamId", "stream-2"}, {"request", http_request("/file")}}, reply, error), "plugin file: " + error);
  snapshot = events.snapshot();
  check(snapshot.size() == 2 && snapshot[0].value("event", "") == "stream.open", "file opens a stream");
  check(snapshot.size() == 2 && snapshot[0].value("status", 0) == 200, "file stream status is 200");
  check(snapshot.size() == 2 && snapshot[1].value("event", "") == "stream.write", "file writes stream data");
  check(snapshot.size() == 2 && plugmesh::base64_decode(snapshot[1].value("data", std::string()), decoded, error) && decoded == "sample-file-stream", "file stream payload matches");

  events.clear();
  check(client.request({{"op", "websocket.data"}, {"connectionId", "conn-1"}, {"data", plugmesh::base64_encode("ping")}, {"text", true}}, reply, error), "plugin websocket: " + error);
  snapshot = events.snapshot();
  check(snapshot.size() == 1 && plugmesh::base64_decode(snapshot[0].value("data", std::string()), decoded, error) && decoded == "ping", "websocket echoes payload");

  check(client.request({{"op", "stop"}}, reply, error), "plugin stop: " + error);
  check(client.alive(), "plugin host is alive after callbacks");
  client.stop();
  check(!client.alive(), "plugin host stops");

  plugmesh::PluginHostClient cancellable;
  EventLog cancel_events;
  cancellable.set_event_handler([&cancel_events](const plugmesh::HostJson& event) { cancel_events.append(event); });
  check(cancellable.start(host_executable, cancellable_library, error), "cancellable host starts: " + error);
  check(cancellable.request({{"op", "start"}}, reply, error), "cancellable plugin start: " + error);
  check(reply.value("ok", false), "cancellable plugin start reply is ok");

  bool cancel_request_ok = false;
  std::string cancel_request_error;
  std::thread blocked_sse([&] {
    plugmesh::HostJson blocked_reply;
    cancel_request_ok = cancellable.request({{"op", "sse"}, {"streamId", "cancel-1"}, {"request", http_request("/cancel-events")}}, blocked_reply, cancel_request_error);
  });
  check(cancel_events.wait_for_log("sse.started:cancel-1"), "blocking SSE reports it started");
  check(cancellable.cancel_sse("cancel-1", "Client disconnected", error), "SSE cancel frame is sent: " + error);
  blocked_sse.join();
  check(cancel_request_ok, "blocking SSE returns after cancellation: " + cancel_request_error);
  snapshot = cancel_events.snapshot();
  bool cancel_log_seen = false;
  bool cancelled_stream_seen = false;
  for (const auto& event : snapshot) {
    if (event.value("event", "") == "log" && event.value("message", "") == "sse.cancelled:cancel-1") cancel_log_seen = true;
    if (event.value("event", "") == "stream.write" && plugmesh::base64_decode(event.value("data", std::string()), decoded, error) && decoded == "data: cancelled\n\n") cancelled_stream_seen = true;
  }
  check(cancel_log_seen, "plugin cancellation callback is invoked");
  check(cancelled_stream_seen, "plugin acknowledges cancellation through the stream");
  check(cancellable.request({{"op", "health"}}, reply, error), "host handles other requests after SSE cancellation: " + error);
  cancellable.stop();

  plugmesh::PluginHostClient crashing;
  check(crashing.start(host_executable, crashing_library, error), "crashing host starts: " + error);
  check(crashing.request({{"op", "start"}}, reply, error), "crashing plugin start: " + error);
  const bool crashed = !crashing.request({{"op", "http"}, {"request", http_request("/boom")}}, reply, error);
  check(crashed, "crashing plugin call fails");
  check(!crashing.alive(), "plugin crash terminates only the host process");
  check(!error.empty(), "crash is reported as an error");
  crashing.stop();

  if (failures == 0) std::cout << "plugin host smoke test passed\n";
  return failures == 0 ? 0 : 1;
}
