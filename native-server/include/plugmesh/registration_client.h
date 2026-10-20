#pragma once

#include <string>

namespace plugmesh {

struct RegistrationResult {
  std::string server_id;
  std::string access_token;
  unsigned int protocol_version = 0;
};

bool register_server(const std::string& worker_url, const std::string& code, const std::string& name, RegistrationResult& result, std::string& error);

}  // namespace plugmesh
