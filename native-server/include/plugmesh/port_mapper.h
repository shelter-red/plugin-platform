#pragma once

#include <memory>
#include <string>

#include <nlohmann/json_fwd.hpp>

namespace plugmesh {

struct ServerConfig;

class PortMapper {
 public:
  PortMapper();
  PortMapper(const PortMapper&) = delete;
  PortMapper& operator=(const PortMapper&) = delete;
  ~PortMapper();

  bool start(const ServerConfig& config, std::string& error);
  void stop();
  std::string snapshot() const;
  nlohmann::json handle_request(const std::string& method, const std::string& resource, const nlohmann::json& payload, std::string& error);

 private:
  struct Impl;
  std::unique_ptr<Impl> impl_;
};

}  // namespace plugmesh
