#pragma once

#include <string>

#include <asio/ip/tcp.hpp>
#include <asio/ssl/context.hpp>
#include <asio/ssl/stream.hpp>
#include <websocketpp/config/asio_client.hpp>

namespace plugmesh {

using TlsContext = websocketpp::lib::shared_ptr<asio::ssl::context>;

TlsContext make_tls_context();
void configure_tls_socket(asio::ssl::stream<asio::ip::tcp::socket>& socket, const std::string& host);

}  // namespace plugmesh
