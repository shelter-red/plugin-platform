#pragma once

#include <filesystem>
#include <mutex>
#include <set>
#include <string>

namespace plugmesh {

class TunnelTrustStore {
 public:
  bool load(const std::filesystem::path& path, const std::string& password_verifier, std::string& error);
  bool trusts(const std::string& source_server_id) const;
  bool trust(const std::string& source_server_id, std::string& error);

 private:
  bool persist(std::string& error) const;

  mutable std::mutex mutex_;
  std::filesystem::path path_;
  std::string verifier_;
  std::set<std::string> trusted_sources_;
};

}  // namespace plugmesh
