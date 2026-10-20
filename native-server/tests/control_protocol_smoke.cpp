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
  if (plugmesh::parse_control_frame("{\"type\":\"invalid\"}", decoded, error)) {
    std::cerr << "invalid control frame was accepted\n";
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
