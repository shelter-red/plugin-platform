#include "plugmesh/control_protocol.h"

#include <iostream>

#include <websocketpp/base64/base64.hpp>

int main() {
  auto original = plugmesh::make_control_frame("server.register", "server-1", {{"manifests", plugmesh::Json::array({{{"id", "sample.plugin"}}})}});
  original.plugin_id = "sample.plugin";
  const auto encoded = plugmesh::serialize_control_frame(original);
  plugmesh::ControlFrame decoded;
  std::string error;
  if (!plugmesh::parse_control_frame(encoded, decoded, error) || decoded.type != original.type || decoded.server_id != original.server_id || decoded.plugin_id != original.plugin_id || decoded.payload != original.payload) {
    std::cerr << "control frame round-trip failed: " << error << '\n';
    return 1;
  }
  plugmesh::ControlFrameReplayGuard replay_guard;
  if (!replay_guard.accept(decoded) || replay_guard.accept(decoded)) {
    std::cerr << "control frame replay guard did not reject a duplicate nonce\n";
    return 1;
  }
  auto stale = plugmesh::make_control_frame("plugin.health", "server-1");
  stale.timestamp = "2000-01-01T00:00:00.000Z";
  if (replay_guard.accept(stale)) {
    std::cerr << "control frame replay guard accepted a stale timestamp\n";
    return 1;
  }
  auto malformed_timestamp = plugmesh::make_control_frame("plugin.health", "server-1");
  malformed_timestamp.timestamp = "2026-02-30T00:00:00.000Z";
  if (replay_guard.accept(malformed_timestamp)) {
    std::cerr << "control frame replay guard accepted an invalid timestamp\n";
    return 1;
  }
  if (plugmesh::parse_control_frame("{\"type\":\"invalid\"}", decoded, error)) {
    std::cerr << "invalid control frame was accepted\n";
    return 1;
  }
  if (plugmesh::parse_control_frame(std::string(plugmesh::kMaxControlFrameBytes + 1, 'x'), decoded, error) || error != "control frame is too large") {
    std::cerr << "oversized control frame was accepted\n";
    return 1;
  }
  auto sync = plugmesh::make_control_frame("server.sync", "server-1");
  sync.request_id = "sync-request-1";
  const auto syncEncoded = plugmesh::serialize_control_frame(sync);
  if (!plugmesh::parse_control_frame(syncEncoded, decoded, error) || decoded.type != "server.sync" || decoded.request_id != "sync-request-1" || decoded.server_id != "server-1") {
    std::cerr << "server sync frame round-trip failed: " << error << '\n';
    return 1;
  }
  auto result = plugmesh::make_control_frame("server.result", "server-1", {{"action", "sync"}, {"ok", true}});
  result.request_id = sync.request_id;
  const auto resultEncoded = plugmesh::serialize_control_frame(result);
  if (!plugmesh::parse_control_frame(resultEncoded, decoded, error) || decoded.type != "server.result" || decoded.request_id != sync.request_id || decoded.payload.value("action", "") != "sync" || !decoded.payload.value("ok", false)) {
    std::cerr << "server sync result frame round-trip failed: " << error << '\n';
    return 1;
  }
  const std::string binary("\x00\x01\x7f\x80\xff", 5);
  if (websocketpp::base64_decode(websocketpp::base64_encode(reinterpret_cast<const unsigned char*>(binary.data()), binary.size())) != binary) {
    std::cerr << "binary frame encoding round-trip failed\n";
    return 1;
  }
  std::cout << "control protocol smoke test passed\n";
  return 0;
}
