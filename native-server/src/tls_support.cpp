#include "plugmesh/tls_support.h"

#include <stdexcept>
#include <system_error>

#include <asio/ssl/rfc2818_verification.hpp>
#include <openssl/ssl.h>

#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>

#include <openssl/err.h>
#include <openssl/x509.h>
#include <openssl/x509_vfy.h>
#endif

namespace plugmesh {

namespace {

#ifdef _WIN32
bool load_windows_root_certificates(SSL_CTX* context) {
  if (!context) return false;
  auto* store = SSL_CTX_get_cert_store(context);
  if (!store) return false;

  const auto certificate_store = CertOpenSystemStoreW(static_cast<HCRYPTPROV_LEGACY>(0), L"ROOT");
  if (!certificate_store) return false;

  bool loaded = false;
  PCCERT_CONTEXT certificate = nullptr;
  while ((certificate = CertEnumCertificatesInStore(certificate_store, certificate)) != nullptr) {
    const unsigned char* encoded = certificate->pbCertEncoded;
    auto* x509 = d2i_X509(nullptr, &encoded, static_cast<long>(certificate->cbCertEncoded));
    if (!x509) {
      ERR_clear_error();
      continue;
    }
    if (X509_STORE_add_cert(store, x509) == 1) loaded = true;
    else ERR_clear_error();  // The certificate may already be present.
    X509_free(x509);
  }
  CertCloseStore(certificate_store, 0);
  return loaded;
}
#endif

}  // namespace

TlsContext make_tls_context() {
  auto context = websocketpp::lib::make_shared<websocketpp::lib::asio::ssl::context>(websocketpp::lib::asio::ssl::context::sslv23);
  context->set_options(websocketpp::lib::asio::ssl::context::default_workarounds |
                       websocketpp::lib::asio::ssl::context::no_sslv2 |
                       websocketpp::lib::asio::ssl::context::no_sslv3 |
                       websocketpp::lib::asio::ssl::context::single_dh_use);

  asio::error_code default_paths_error;
  context->set_default_verify_paths(default_paths_error);
#ifdef _WIN32
  const auto windows_roots_loaded = load_windows_root_certificates(context->native_handle());
  if (default_paths_error && !windows_roots_loaded) {
    throw std::system_error(default_paths_error, "set_default_verify_paths");
  }
#else
  if (default_paths_error) throw std::system_error(default_paths_error, "set_default_verify_paths");
#endif

  context->set_verify_mode(websocketpp::lib::asio::ssl::verify_peer);
  return context;
}

void configure_tls_socket(asio::ssl::stream<asio::ip::tcp::socket>& socket, const std::string& host) {
  socket.set_verify_callback(asio::ssl::rfc2818_verification(host));
  if (!host.empty() && SSL_set_tlsext_host_name(socket.native_handle(), host.c_str()) != 1) {
    throw std::runtime_error("unable to configure TLS server name");
  }
}

}  // namespace plugmesh
