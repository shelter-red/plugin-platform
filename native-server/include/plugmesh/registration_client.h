#pragma once

#include <string>

namespace plugmesh {

struct RegistrationResult {
  std::string server_id;
  std::string access_token;
  unsigned int protocol_version = 0;
};

enum class RegistrationFailure {
  none,
  invalid_input,
  code_invalid_or_expired,
  connection_failed,
  tls_failed,
  invalid_response,
};

const char* registration_failure_code(RegistrationFailure failure);
bool register_server(const std::string& worker_url, const std::string& code, const std::string& name, RegistrationResult& result, std::string& error, RegistrationFailure* failure = nullptr);

}  // namespace plugmesh
