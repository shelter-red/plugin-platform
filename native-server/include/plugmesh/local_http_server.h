#pragma once

#include <atomic>
#include <cstdint>
#include <string>

namespace plugmesh {

class LocalHttpServer {
 public:
  explicit LocalHttpServer(uint16_t port = 8787);
  LocalHttpServer(const LocalHttpServer&) = delete;
  LocalHttpServer& operator=(const LocalHttpServer&) = delete;

  bool run(std::string& error);
  void stop();

 private:
  void handle_http(void* handle);

  uint16_t port_;
  std::atomic<bool> stopping_{false};
  std::atomic<void*> server_{nullptr};
};

}  // namespace plugmesh
