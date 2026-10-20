#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <string>

#include <nlohmann/json.hpp>

namespace plugmesh {

class PluginManager;

class LocalHttpServer {
 public:
  using StatusProvider = std::function<nlohmann::json()>;

  explicit LocalHttpServer(uint16_t port = 8787, PluginManager* plugins = nullptr, StatusProvider status_provider = {});
  LocalHttpServer(const LocalHttpServer&) = delete;
  LocalHttpServer& operator=(const LocalHttpServer&) = delete;

  bool run(std::string& error);
  void stop();

 private:
  void handle_http(void* handle);

  uint16_t port_;
  PluginManager* plugins_;
  StatusProvider status_provider_;
  std::atomic<bool> stopping_{false};
  std::atomic<void*> server_{nullptr};
};

}  // namespace plugmesh
