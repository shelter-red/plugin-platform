#include "plugmesh/tls_support.h"

#include <iostream>

int main() {
  try {
    const auto context = plugmesh::make_tls_context();
    if (!context) {
      std::cerr << "TLS context was not created\n";
      return 1;
    }
  } catch (const std::exception& exception) {
    std::cerr << "TLS context setup failed: " << exception.what() << '\n';
    return 1;
  }
  std::cout << "TLS context smoke test passed\n";
  return 0;
}
