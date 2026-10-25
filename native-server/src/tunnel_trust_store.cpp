#include "plugmesh/tunnel_trust_store.h"

#include <array>
#include <fstream>
#include <system_error>

#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/hmac.h>

#if !defined(_WIN32)
#include <sys/stat.h>
#endif

namespace plugmesh {
namespace {

using Json = nlohmann::json;

std::string mac_for(const std::string& verifier, const std::set<std::string>& sources) {
  const auto message = Json(sources).dump();
  std::array<unsigned char, EVP_MAX_MD_SIZE> digest{};
  unsigned int length = 0;
  if (!HMAC(EVP_sha256(), verifier.data(), static_cast<int>(verifier.size()), reinterpret_cast<const unsigned char*>(message.data()), message.size(), digest.data(), &length)) return {};
  static constexpr char digits[] = "0123456789abcdef";
  std::string result;
  result.reserve(length * 2);
  for (unsigned int i = 0; i < length; ++i) {
    result.push_back(digits[digest[i] >> 4]);
    result.push_back(digits[digest[i] & 0x0f]);
  }
  return result;
}

}  // namespace

bool TunnelTrustStore::load(const std::filesystem::path& path, const std::string& password_verifier, std::string& error) {
  std::lock_guard lock(mutex_);
  path_ = path;
  verifier_ = password_verifier;
  trusted_sources_.clear();
  if (path_.empty() || verifier_.empty()) {
    error = "tunnel trust storage is not configured";
    return false;
  }
  std::ifstream input(path_);
  if (!input) return true;
  Json state;
  try {
    input >> state;
    const auto values = state.at("trustedSourceServerIds").get<std::set<std::string>>();
    const auto stored_mac = state.at("mac").get<std::string>();
    const auto expected_mac = mac_for(verifier_, values);
    if (expected_mac.empty() || stored_mac.size() != expected_mac.size() || CRYPTO_memcmp(stored_mac.data(), expected_mac.data(), expected_mac.size()) != 0) {
      error = "tunnel trust state is invalid; previous authorizations were discarded";
      return persist(error);
    }
    for (const auto& source : values) {
      if (source.empty() || source.size() > 128) {
        error = "tunnel trust state contains an invalid server ID";
        return persist(error);
      }
    }
    trusted_sources_ = values;
    return true;
  } catch (...) {
    error = "tunnel trust state is invalid; previous authorizations were discarded";
    trusted_sources_.clear();
    return persist(error);
  }
}

bool TunnelTrustStore::trusts(const std::string& source_server_id) const {
  std::lock_guard lock(mutex_);
  return trusted_sources_.contains(source_server_id);
}

bool TunnelTrustStore::trust(const std::string& source_server_id, std::string& error) {
  if (source_server_id.empty() || source_server_id.size() > 128) {
    error = "source server ID is invalid";
    return false;
  }
  std::lock_guard lock(mutex_);
  if (trusted_sources_.contains(source_server_id)) return true;
  if (trusted_sources_.size() >= 2048) {
    error = "tunnel trust limit reached";
    return false;
  }
  trusted_sources_.insert(source_server_id);
  if (persist(error)) return true;
  trusted_sources_.erase(source_server_id);
  return false;
}

bool TunnelTrustStore::persist(std::string& error) const {
  std::error_code filesystem_error;
  std::filesystem::create_directories(path_.parent_path(), filesystem_error);
  if (filesystem_error) {
    error = "unable to create tunnel trust directory";
    return false;
  }
  const auto temporary = path_.string() + ".tmp";
  const Json state{{"trustedSourceServerIds", trusted_sources_}, {"mac", mac_for(verifier_, trusted_sources_)}};
  {
    std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
    if (!output) {
      error = "unable to write tunnel trust state";
      return false;
    }
    output << state.dump(2);
    output.close();
    if (!output) {
      error = "unable to flush tunnel trust state";
      return false;
    }
  }
#if !defined(_WIN32)
  if (::chmod(temporary.c_str(), S_IRUSR | S_IWUSR) != 0) {
    std::filesystem::remove(temporary, filesystem_error);
    error = "unable to protect tunnel trust state";
    return false;
  }
#endif
  std::filesystem::rename(temporary, path_, filesystem_error);
  if (filesystem_error) {
    std::filesystem::remove(temporary);
    error = "unable to replace tunnel trust state";
    return false;
  }
  return true;
}

}  // namespace plugmesh
