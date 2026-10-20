#include "plugmesh/credential_store.h"

#include <array>
#include <fstream>
#include <vector>

#include <nlohmann/json.hpp>
#include <openssl/evp.h>
#include <openssl/rand.h>

#if defined(PLUGMESH_PLATFORM_POSIX)
#include <sys/stat.h>
#endif

namespace plugmesh {

namespace {

using Json = nlohmann::json;
constexpr int kIterations = 200000;
constexpr std::size_t kSaltSize = 16;
constexpr std::size_t kIvSize = 12;
constexpr std::size_t kTagSize = 16;
constexpr std::size_t kMaxCiphertextSize = 1024 * 1024;

std::string encode_base64(const std::vector<unsigned char>& bytes) {
  if (bytes.empty()) return {};
  std::string encoded(4 * ((bytes.size() + 2) / 3), '\0');
  const auto size = EVP_EncodeBlock(reinterpret_cast<unsigned char*>(encoded.data()), bytes.data(), static_cast<int>(bytes.size()));
  encoded.resize(size > 0 ? static_cast<std::size_t>(size) : 0);
  return encoded;
}

bool decode_base64(const std::string& encoded, std::vector<unsigned char>& bytes) {
  if (encoded.empty() || encoded.size() % 4 != 0) return false;
  bytes.assign(3 * (encoded.size() / 4), 0);
  const auto size = EVP_DecodeBlock(bytes.data(), reinterpret_cast<const unsigned char*>(encoded.data()), static_cast<int>(encoded.size()));
  if (size < 0) return false;
  std::size_t padding = 0;
  if (!encoded.empty() && encoded.back() == '=') ++padding;
  if (encoded.size() > 1 && encoded[encoded.size() - 2] == '=') ++padding;
  if (static_cast<std::size_t>(size) < padding) return false;
  bytes.resize(static_cast<std::size_t>(size) - padding);
  return true;
}

bool derive_key(const std::string& password, const std::vector<unsigned char>& salt, std::array<unsigned char, 32>& key) {
  return !password.empty() && !salt.empty() && PKCS5_PBKDF2_HMAC(password.c_str(), static_cast<int>(password.size()), salt.data(), static_cast<int>(salt.size()), kIterations, EVP_sha256(), static_cast<int>(key.size()), key.data()) == 1;
}

bool encrypt(const std::string& plaintext, const std::string& password, Json& envelope, std::string& error) {
  std::vector<unsigned char> salt(kSaltSize), iv(kIvSize);
  if (RAND_bytes(salt.data(), static_cast<int>(salt.size())) != 1 || RAND_bytes(iv.data(), static_cast<int>(iv.size())) != 1) {
    error = "unable to generate credential encryption nonce";
    return false;
  }
  std::array<unsigned char, 32> key{};
  if (!derive_key(password, salt, key)) {
    error = "credential password is required";
    return false;
  }
  auto* context = EVP_CIPHER_CTX_new();
  if (!context) {
    error = "unable to allocate credential encryption context";
    return false;
  }
  std::vector<unsigned char> ciphertext(plaintext.size() + EVP_MAX_BLOCK_LENGTH);
  int written = 0;
  int final_written = 0;
  bool ok = EVP_EncryptInit_ex(context, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
      EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()), nullptr) == 1 &&
      EVP_EncryptInit_ex(context, nullptr, nullptr, key.data(), iv.data()) == 1 &&
      EVP_EncryptUpdate(context, ciphertext.data(), &written, reinterpret_cast<const unsigned char*>(plaintext.data()), static_cast<int>(plaintext.size())) == 1 &&
      EVP_EncryptFinal_ex(context, ciphertext.data() + written, &final_written) == 1;
  std::vector<unsigned char> tag(kTagSize);
  if (ok) ok = EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_GET_TAG, static_cast<int>(tag.size()), tag.data()) == 1;
  EVP_CIPHER_CTX_free(context);
  if (!ok) {
    error = "unable to encrypt credentials";
    return false;
  }
  ciphertext.resize(static_cast<std::size_t>(written + final_written));
  envelope = {
      {"version", 1},
      {"kdf", "PBKDF2-HMAC-SHA256"},
      {"iterations", kIterations},
      {"salt", encode_base64(salt)},
      {"iv", encode_base64(iv)},
      {"ciphertext", encode_base64(ciphertext)},
      {"tag", encode_base64(tag)},
  };
  return true;
}

bool decrypt(const Json& envelope, const std::string& password, std::string& plaintext, std::string& error) {
  if (!envelope.is_object() || envelope.value("version", 0) != 1 || envelope.value("kdf", "") != "PBKDF2-HMAC-SHA256" || envelope.value("iterations", 0) != kIterations) {
    error = "unsupported credential file format";
    return false;
  }
  std::vector<unsigned char> salt, iv, ciphertext, tag;
  if (!decode_base64(envelope.value("salt", ""), salt) || !decode_base64(envelope.value("iv", ""), iv) || !decode_base64(envelope.value("ciphertext", ""), ciphertext) || !decode_base64(envelope.value("tag", ""), tag) || salt.size() != kSaltSize || iv.size() != kIvSize || tag.size() != kTagSize || ciphertext.size() > kMaxCiphertextSize) {
    error = "invalid credential file encoding";
    return false;
  }
  std::array<unsigned char, 32> key{};
  if (!derive_key(password, salt, key)) {
    error = "credential password is required";
    return false;
  }
  auto* context = EVP_CIPHER_CTX_new();
  if (!context) {
    error = "unable to allocate credential decryption context";
    return false;
  }
  std::vector<unsigned char> decoded(ciphertext.size() + EVP_MAX_BLOCK_LENGTH);
  int written = 0;
  int final_written = 0;
  bool ok = EVP_DecryptInit_ex(context, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
      EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()), nullptr) == 1 &&
      EVP_DecryptInit_ex(context, nullptr, nullptr, key.data(), iv.data()) == 1 &&
      EVP_DecryptUpdate(context, decoded.data(), &written, ciphertext.data(), static_cast<int>(ciphertext.size())) == 1 &&
      EVP_CIPHER_CTX_ctrl(context, EVP_CTRL_GCM_SET_TAG, static_cast<int>(tag.size()), tag.data()) == 1 &&
      EVP_DecryptFinal_ex(context, decoded.data() + written, &final_written) == 1;
  EVP_CIPHER_CTX_free(context);
  if (!ok) {
    error = "credential password is invalid or file is corrupted";
    return false;
  }
  plaintext.assign(reinterpret_cast<const char*>(decoded.data()), static_cast<std::size_t>(written + final_written));
  return true;
}

bool write_file(const std::filesystem::path& path, const std::string& content, std::string& error) {
  std::error_code directory_error;
  if (path.has_parent_path()) std::filesystem::create_directories(path.parent_path(), directory_error);
  if (directory_error) {
    error = "unable to create credential directory";
    return false;
  }
  std::ofstream file(path, std::ios::binary | std::ios::trunc);
  if (!file) {
    error = "unable to open credential file for writing";
    return false;
  }
#if defined(PLUGMESH_PLATFORM_POSIX)
  ::chmod(path.c_str(), S_IRUSR | S_IWUSR);
#endif
  file << content;
  if (!file.good()) {
    error = "unable to write credential file";
    return false;
  }
  return true;
}

}  // namespace

bool save_credentials(const std::filesystem::path& path, const StoredCredentials& credentials, const std::string& password, std::string& error) {
  if (path.empty() || credentials.worker_url.empty() || credentials.server_id.empty() || credentials.access_token.empty()) {
    error = "credential file path and all credentials are required";
    return false;
  }
  Json envelope;
  const auto plaintext = Json{{"workerUrl", credentials.worker_url}, {"serverId", credentials.server_id}, {"accessToken", credentials.access_token}}.dump();
  if (!encrypt(plaintext, password, envelope, error)) return false;
  return write_file(path, envelope.dump(2), error);
}

bool load_credentials(const std::filesystem::path& path, const std::string& password, StoredCredentials& credentials, std::string& error) {
  std::ifstream file(path, std::ios::binary);
  if (!file) {
    error = "unable to open credential file";
    return false;
  }
  Json envelope;
  try {
    file >> envelope;
  } catch (...) {
    error = "invalid credential file";
    return false;
  }
  std::string plaintext;
  if (!decrypt(envelope, password, plaintext, error)) return false;
  try {
    const auto value = Json::parse(plaintext);
    credentials.worker_url = value.at("workerUrl").get<std::string>();
    credentials.server_id = value.at("serverId").get<std::string>();
    credentials.access_token = value.at("accessToken").get<std::string>();
  } catch (...) {
    error = "credential payload is invalid";
    return false;
  }
  if (credentials.worker_url.empty() || credentials.server_id.empty() || credentials.access_token.empty()) {
    error = "credential payload is incomplete";
    return false;
  }
  return true;
}

bool load_credentials_into_config(const std::filesystem::path& path, const std::string& password, std::string& worker_url, std::string& server_id, std::string& access_token, std::string& error) {
  StoredCredentials credentials;
  if (!load_credentials(path, password, credentials, error)) return false;
  if (worker_url.empty()) worker_url = credentials.worker_url;
  if (server_id.empty()) server_id = credentials.server_id;
  if (access_token.empty()) access_token = credentials.access_token;
  return true;
}

}  // namespace plugmesh
