#include "plugmesh/control_protocol.h"

#include <iostream>

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
  if (plugmesh::parse_control_frame("{\"type\":\"invalid\"}", decoded, error)) {
    std::cerr << "invalid control frame was accepted\n";
    return 1;
  }
  std::cout << "control protocol smoke test passed\n";
  return 0;
}
