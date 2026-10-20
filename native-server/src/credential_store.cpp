#include "plugmesh/credential_store.h"

#include <array>
#include <fstream>
#include <vector>

#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/rand.h>

#if defined(PLUGMESH_PLATFORM_POSIX)
#include <sys/stat.h>
#endif

#if defined(_WIN32)
#include <windows.h>
#include <wincred.h>
#elif defined(__APPLE__)
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#endif

namespace plugmesh {

namespace {

using Json = nlohmann::json;
constexpr int kIterations = 200000;
constexpr std::size_t kSaltSize = 16;
constexpr std::size_t kIvSize = 12;
constexpr std::size_t kTagSize = 16;
constexpr std::size_t kPasswordHashSize = 32;
constexpr std::size_t kMaxCiphertextSize = 1024 * 1024;
constexpr char kSystemService[] = "Plugmesh";
constexpr char kSystemAccount[] = "default";

std::string credentials_json(const StoredCredentials& credentials) {
  Json value{{"workerUrl", credentials.worker_url}, {"serverId", credentials.server_id}, {"accessToken", credentials.access_token}};
  if (!credentials.local_ui_password_verifier.empty()) value["localUiPasswordVerifier"] = credentials.local_ui_password_verifier;
  return value.dump();
}

bool parse_credentials_json(const std::string& plaintext, StoredCredentials& credentials, std::string& error) {
  try {
    const auto value = Json::parse(plaintext);
    credentials.worker_url = value.at("workerUrl").get<std::string>();
    credentials.server_id = value.at("serverId").get<std::string>();
    credentials.access_token = value.at("accessToken").get<std::string>();
    credentials.local_ui_password_verifier = value.value("localUiPasswordVerifier", std::string());
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

bool make_local_ui_password_verifier(const std::string& password, std::string& verifier, std::string& error) {
  if (password.empty()) {
    error = "local UI password is required";
    return false;
  }
  std::vector<unsigned char> salt(kSaltSize);
  if (RAND_bytes(salt.data(), static_cast<int>(salt.size())) != 1) {
    error = "unable to generate local UI password salt";
    return false;
  }
  std::array<unsigned char, kPasswordHashSize> hash{};
  if (!derive_key(password, salt, hash)) {
    error = "unable to derive local UI password verifier";
    return false;
  }
  verifier = Json{
      {"version", 1},
      {"kdf", "PBKDF2-HMAC-SHA256"},
      {"iterations", kIterations},
      {"salt", encode_base64(salt)},
      {"hash", encode_base64(std::vector<unsigned char>(hash.begin(), hash.end()))},
  }.dump();
  return true;
}

bool verify_local_ui_password(const std::string& password, const std::string& verifier) {
  if (password.empty() || verifier.empty()) return false;
  try {
    const auto value = Json::parse(verifier);
    if (!value.is_object() || value.value("version", 0) != 1 || value.value("kdf", "") != "PBKDF2-HMAC-SHA256" || value.value("iterations", 0) != kIterations) return false;
    std::vector<unsigned char> salt;
    std::vector<unsigned char> expected;
    if (!decode_base64(value.value("salt", ""), salt) || !decode_base64(value.value("hash", ""), expected) || salt.size() != kSaltSize || expected.size() != kPasswordHashSize) return false;
    std::array<unsigned char, kPasswordHashSize> actual{};
    if (!derive_key(password, salt, actual)) return false;
    return CRYPTO_memcmp(actual.data(), expected.data(), expected.size()) == 0;
  } catch (...) {
    return false;
  }
}

bool system_credentials_available() {
#if defined(_WIN32) || defined(__APPLE__)
  return true;
#else
  return false;
#endif
}

bool save_system_credentials(const StoredCredentials& credentials, std::string& error) {
  if (credentials.worker_url.empty() || credentials.server_id.empty() || credentials.access_token.empty()) {
    error = "all credentials are required";
    return false;
  }
  const auto plaintext = credentials_json(credentials);
#if defined(_WIN32)
  CREDENTIALA credential{};
  credential.Type = CRED_TYPE_GENERIC;
  credential.TargetName = const_cast<char*>("Plugmesh/default");
  credential.CredentialBlobSize = static_cast<DWORD>(plaintext.size());
  credential.CredentialBlob = reinterpret_cast<LPBYTE>(const_cast<char*>(plaintext.data()));
  credential.Persist = CRED_PERSIST_LOCAL_MACHINE;
  if (!CredWriteA(&credential, 0)) {
    error = "Windows Credential Manager write failed";
    return false;
  }
  return true;
#elif defined(__APPLE__)
  CFDataRef data = CFDataCreate(kCFAllocatorDefault, reinterpret_cast<const UInt8*>(plaintext.data()), static_cast<CFIndex>(plaintext.size()));
  CFStringRef service = CFStringCreateWithCString(kCFAllocatorDefault, kSystemService, kCFStringEncodingUTF8);
  CFStringRef account = CFStringCreateWithCString(kCFAllocatorDefault, kSystemAccount, kCFStringEncodingUTF8);
  const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecValueData};
  const void* values[] = {kSecClassGenericPassword, service, account, data};
  CFDictionaryRef query = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 4, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  const auto status = SecItemAdd(query, nullptr);
  CFRelease(query);
  if (status == errSecDuplicateItem) {
    const void* query_keys[] = {kSecClass, kSecAttrService, kSecAttrAccount};
    const void* query_values[] = {kSecClassGenericPassword, service, account};
    CFDictionaryRef update_query = CFDictionaryCreate(kCFAllocatorDefault, query_keys, query_values, 3, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    const void* update_keys[] = {kSecValueData};
    const void* update_values[] = {data};
    CFDictionaryRef update_values_dictionary = CFDictionaryCreate(kCFAllocatorDefault, update_keys, update_values, 1, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
    const auto update_status = SecItemUpdate(update_query, update_values_dictionary);
    CFRelease(update_values_dictionary);
    CFRelease(update_query);
    CFRelease(account);
    CFRelease(service);
    CFRelease(data);
    if (update_status != errSecSuccess) {
      error = "macOS Keychain update failed";
      return false;
    }
    return true;
  }
  CFRelease(account);
  CFRelease(service);
  CFRelease(data);
  if (status != errSecSuccess) {
    error = "macOS Keychain write failed";
    return false;
  }
  return true;
#else
  error = "system credential store is unavailable on this platform";
  return false;
#endif
}

bool load_system_credentials(StoredCredentials& credentials, std::string& error) {
#if defined(_WIN32)
  PCREDENTIALA credential = nullptr;
  if (!CredReadA("Plugmesh/default", CRED_TYPE_GENERIC, 0, &credential)) {
    error = "system credentials were not found";
    return false;
  }
  const std::string plaintext(reinterpret_cast<const char*>(credential->CredentialBlob), credential->CredentialBlobSize);
  CredFree(credential);
  return parse_credentials_json(plaintext, credentials, error);
#elif defined(__APPLE__)
  CFStringRef service = CFStringCreateWithCString(kCFAllocatorDefault, kSystemService, kCFStringEncodingUTF8);
  CFStringRef account = CFStringCreateWithCString(kCFAllocatorDefault, kSystemAccount, kCFStringEncodingUTF8);
  const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount, kSecReturnData};
  const void* values[] = {kSecClassGenericPassword, service, account, kCFBooleanTrue};
  CFDictionaryRef query = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 4, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  CFTypeRef result = nullptr;
  const auto status = SecItemCopyMatching(query, &result);
  CFRelease(query);
  CFRelease(account);
  CFRelease(service);
  if (status != errSecSuccess || !result || CFGetTypeID(result) != CFDataGetTypeID()) {
    if (result) CFRelease(result);
    error = "system credentials were not found";
    return false;
  }
  const auto* bytes = CFDataGetBytePtr(static_cast<CFDataRef>(result));
  const auto size = CFDataGetLength(static_cast<CFDataRef>(result));
  const std::string plaintext(reinterpret_cast<const char*>(bytes), static_cast<std::size_t>(size));
  CFRelease(result);
  return parse_credentials_json(plaintext, credentials, error);
#else
  error = "system credential store is unavailable on this platform";
  return false;
#endif
}

bool remove_system_credentials(std::string& error) {
#if defined(_WIN32)
  if (!CredDeleteA("Plugmesh/default", CRED_TYPE_GENERIC, 0)) {
    if (GetLastError() == ERROR_NOT_FOUND) return true;
    error = "Windows Credential Manager delete failed";
    return false;
  }
  return true;
#elif defined(__APPLE__)
  CFStringRef service = CFStringCreateWithCString(kCFAllocatorDefault, kSystemService, kCFStringEncodingUTF8);
  CFStringRef account = CFStringCreateWithCString(kCFAllocatorDefault, kSystemAccount, kCFStringEncodingUTF8);
  const void* keys[] = {kSecClass, kSecAttrService, kSecAttrAccount};
  const void* values[] = {kSecClassGenericPassword, service, account};
  CFDictionaryRef query = CFDictionaryCreate(kCFAllocatorDefault, keys, values, 3, &kCFTypeDictionaryKeyCallBacks, &kCFTypeDictionaryValueCallBacks);
  const auto status = SecItemDelete(query);
  CFRelease(query);
  CFRelease(account);
  CFRelease(service);
  if (status != errSecSuccess && status != errSecItemNotFound) {
    error = "macOS Keychain delete failed";
    return false;
  }
  return true;
#else
  error = "system credential store is unavailable on this platform";
  return false;
#endif
}

bool save_credentials(const std::filesystem::path& path, const StoredCredentials& credentials, const std::string& password, std::string& error) {
  if (path.empty()) return save_system_credentials(credentials, error);
  if (credentials.worker_url.empty() || credentials.server_id.empty() || credentials.access_token.empty()) {
    error = "credential file path and all credentials are required";
    return false;
  }
  Json envelope;
  const auto plaintext = credentials_json(credentials);
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
  return parse_credentials_json(plaintext, credentials, error);
}

bool remove_credentials(const std::filesystem::path& path, std::string& error) {
  if (path.empty()) return remove_system_credentials(error);
  std::error_code remove_error;
  const auto removed = std::filesystem::remove(path, remove_error);
  if (remove_error) {
    error = "unable to delete credential file";
    return false;
  }
  return removed || !std::filesystem::exists(path);
}

bool load_credentials_into_config(const std::filesystem::path& path, const std::string& password, std::string& worker_url, std::string& server_id, std::string& access_token, std::string& local_ui_password_verifier, std::string& error) {
  StoredCredentials credentials;
  if (path.empty()) {
    if (!load_system_credentials(credentials, error)) return false;
  } else if (!load_credentials(path, password, credentials, error)) return false;
  if (worker_url.empty()) worker_url = credentials.worker_url;
  if (server_id.empty()) server_id = credentials.server_id;
  if (access_token.empty()) access_token = credentials.access_token;
  if (local_ui_password_verifier.empty()) local_ui_password_verifier = credentials.local_ui_password_verifier;
  return true;
}

}  // namespace plugmesh
