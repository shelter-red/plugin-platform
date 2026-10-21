#include "plugmesh/plugin_host_client.h"
#include "plugmesh/plugin_host_protocol.h"

#include <iostream>
#include <string>
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

}  // namespace

int main(int argc, char** argv) {
  if (argc != 4) {
    std::cerr << "usage: plugin-host-smoke <host> <sample-library> <crashing-library>" << '\n';
    return 2;
  }
  const std::string host_executable = argv[1];
  const std::string sample_library = argv[2];
  const std::string crashing_library = argv[3];

  plugmesh::PluginHostClient client;
  std::vector<plugmesh::HostJson> events;
  client.set_event_handler([&events](const plugmesh::HostJson& event) { events.push_back(event); });

  std::string error;
  check(client.start(host_executable, sample_library, error), "plugin host starts: " + error);

  plugmesh::HostJson reply;
  check(client.request({{"op", "start"}}, reply, error), "plugin start: " + error);
  check(reply.value("ok", false), "plugin start reply is ok");

  check(!events.empty() && events.front().value("event", "") == "ready", "host announces ready");
  check(!events.empty() && events.front().value("pluginId", "") == "sample.plugin", "host reports plugin id");

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
  check(events.size() == 1 && events[0].value("event", "") == "stream.write", "sse emits one stream write");
  check(plugmesh::base64_decode(events[0].value("data", std::string()), decoded, error) && decoded == "data: sample-plugin\n\n", "sse payload matches");
  check(events[0].value("finished", 0) == 1, "sse stream is finished");

  events.clear();
  check(client.request({{"op", "file"}, {"streamId", "stream-2"}, {"request", http_request("/file")}}, reply, error), "plugin file: " + error);
  check(events.size() == 2 && events[0].value("event", "") == "stream.open", "file opens a stream");
  check(events.size() == 2 && events[0].value("status", 0) == 200, "file stream status is 200");
  check(events.size() == 2 && events[1].value("event", "") == "stream.write", "file writes stream data");
  check(events.size() == 2 && plugmesh::base64_decode(events[1].value("data", std::string()), decoded, error) && decoded == "sample-file-stream", "file stream payload matches");

  events.clear();
  check(client.request({{"op", "websocket.data"}, {"connectionId", "conn-1"}, {"data", plugmesh::base64_encode("ping")}, {"text", true}}, reply, error), "plugin websocket: " + error);
  check(events.size() == 1 && plugmesh::base64_decode(events[0].value("data", std::string()), decoded, error) && decoded == "ping", "websocket echoes payload");

  check(client.request({{"op", "stop"}}, reply, error), "plugin stop: " + error);
  check(client.alive(), "plugin host is alive after callbacks");
  client.stop();
  check(!client.alive(), "plugin host stops");

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
