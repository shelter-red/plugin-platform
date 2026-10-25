#include "plugmesh/port_mapper.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/server_config.h"
#include "plugmesh/tls_support.h"
#include "plugmesh/tunnel_protocol.h"

#ifdef _WIN32
#include <winsock2.h>
#else
#include <sys/socket.h>
#endif

#include <asio.hpp>
#include <asio/ssl.hpp>
#include <nlohmann/json.hpp>
#include <openssl/crypto.h>
#include <websocketpp/client.hpp>
#include <websocketpp/config/asio_client.hpp>

#include <algorithm>
#include <array>
#include <condition_variable>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#if !defined(_WIN32)
#include <sys/stat.h>
#endif

namespace {
using Json = nlohmann::json;
using Tcp = asio::ip::tcp;
using PlainClient = websocketpp::client<websocketpp::config::asio_client>;
using TlsClient = websocketpp::client<websocketpp::config::asio_tls_client>;
using TlsContext = websocketpp::lib::shared_ptr<websocketpp::lib::asio::ssl::context>;

struct Settings {
  std::string worker_url;
  std::string source_server_id;
  std::string access_token;
};

struct Mapping {
  std::string name;
  std::string protocol;
  std::string target_server_id;
  std::string target_server_name;
  std::string target_host;
  std::shared_ptr<std::string> target_password;
  bool enabled = true;
  uint16_t listen_port{};
  uint16_t target_port{};
};

struct WorkerUri {
  std::string host;
  std::string port;
  std::string scheme;
  bool secure = false;
};

struct TunnelState {
  std::mutex mutex;
  std::condition_variable changed;
  bool ready = false;
  bool failed = false;
  bool local_fin = false;
  bool remote_fin = false;
  std::string failure;
  std::string session_id;
  Tcp::socket* local = nullptr;
};

struct TunnelPasswordGuard {
  std::shared_ptr<std::string> value;

  ~TunnelPasswordGuard() {
    if (value && !value->empty()) {
      OPENSSL_cleanse(value->data(), value->size());
      value->clear();
    }
  }
};

bool read_port(const Json& value, const char* key, uint16_t& port) {
  if (!value.contains(key) || !value.at(key).is_number_integer()) return false;
  const auto number = value.at(key).get<int64_t>();
  if (number < 1 || number > 65535) return false;
  port = static_cast<uint16_t>(number);
  return true;
}

Settings load_settings(const plugmesh::ServerConfig& config) {
  if (config.worker_url.empty() || config.server_id.empty() || config.access_token.empty()) throw std::runtime_error("plugin server connection credentials are unavailable");
  return {config.worker_url, config.server_id, config.access_token};
}

WorkerUri parse_worker_uri(const std::string& value) {
  const auto scheme_end = value.find("://");
  if (scheme_end == std::string::npos) throw std::runtime_error("workerUrl must use http:// or https://");
  WorkerUri result;
  result.scheme = value.substr(0, scheme_end);
  result.secure = result.scheme == "https";
  if (!result.secure && result.scheme != "http") throw std::runtime_error("workerUrl must use http:// or https://");
  const auto authority_start = scheme_end + 3;
  const auto authority_end = value.find_first_of("/?#", authority_start);
  auto authority = value.substr(authority_start, authority_end == std::string::npos ? std::string::npos : authority_end - authority_start);
  if (authority.empty() || authority.find('@') != std::string::npos) throw std::runtime_error("workerUrl host is invalid");
  if (authority.front() == '[') {
    const auto close = authority.find(']');
    if (close == std::string::npos) throw std::runtime_error("workerUrl IPv6 host is invalid");
    result.host = authority.substr(1, close - 1);
    if (close + 1 < authority.size()) result.port = authority.substr(close + 2);
  } else {
    const auto colon = authority.rfind(':');
    if (colon != std::string::npos && authority.find(':') == colon) {
      result.host = authority.substr(0, colon);
      result.port = authority.substr(colon + 1);
    } else result.host = authority;
  }
  if (result.port.empty()) result.port = result.secure ? "443" : "80";
  if (result.host.empty()) throw std::runtime_error("workerUrl host is invalid");
  return result;
}

std::string url_encode(const std::string& input) {
  static constexpr char hex[] = "0123456789ABCDEF";
  std::string result;
  for (const unsigned char value : input) {
    if ((value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z') || (value >= '0' && value <= '9') || value == '-' || value == '_' || value == '.' || value == '~') result.push_back(static_cast<char>(value));
    else {
      result.push_back('%');
      result.push_back(hex[value >> 4]);
      result.push_back(hex[value & 0x0f]);
    }
  }
  return result;
}

template <typename Stream>
std::string http_get(Stream& stream, const WorkerUri& uri, const Settings& settings) {
  asio::io_context resolver_context;
  Tcp::resolver resolver(resolver_context);
  const auto endpoints = resolver.resolve(uri.host, uri.port);
  asio::connect(stream.lowest_layer(), endpoints);
  if constexpr (std::is_same_v<Stream, asio::ssl::stream<Tcp::socket>>) {
    plugmesh::configure_tls_socket(stream, uri.host);
    stream.handshake(asio::ssl::stream_base::client);
  }
  const auto path = "/control/tunnel/targets?serverId=" + url_encode(settings.source_server_id);
  const auto request = "GET " + path + " HTTP/1.1\r\nHost: " + uri.host + "\r\nAuthorization: Bearer " + settings.access_token + "\r\nConnection: close\r\nAccept: application/json\r\n\r\n";
  asio::write(stream, asio::buffer(request));
  std::string response;
  std::array<char, 4096> buffer{};
  asio::error_code error;
  while (true) {
    const auto size = stream.read_some(asio::buffer(buffer), error);
    if (size) response.append(buffer.data(), size);
    if (error) break;
  }
  if (error != asio::error::eof && error != asio::ssl::error::stream_truncated) throw std::system_error(error, "read target server list");
  const auto header_end = response.find("\r\n\r\n");
  if (header_end == std::string::npos) throw std::runtime_error("Worker returned an invalid target list response");
  const auto status_end = response.find("\r\n");
  if (status_end == std::string::npos || response.substr(0, status_end).find(" 200 ") == std::string::npos) throw std::runtime_error("Worker rejected target server discovery");
  auto body = response.substr(header_end + 4);
  const auto headers = response.substr(status_end + 2, header_end - status_end - 2);
  if (headers.find("transfer-encoding: chunked") != std::string::npos || headers.find("Transfer-Encoding: chunked") != std::string::npos) {
    std::string decoded;
    std::size_t offset = 0;
    while (offset < body.size()) {
      const auto end = body.find("\r\n", offset);
      if (end == std::string::npos) throw std::runtime_error("Worker returned malformed chunked data");
      const auto length = std::stoul(body.substr(offset, end - offset), nullptr, 16);
      if (length == 0) break;
      offset = end + 2;
      if (offset + length + 2 > body.size()) throw std::runtime_error("Worker returned truncated target list");
      decoded.append(body, offset, length);
      offset += length + 2;
    }
    body = std::move(decoded);
  }
  return body;
}

std::string fetch_targets(const Settings& settings) {
  const auto uri = parse_worker_uri(settings.worker_url);
  asio::io_context context;
  if (uri.secure) {
    auto tls = plugmesh::make_tls_context();
    asio::ssl::stream<Tcp::socket> stream(context, *tls);
    return http_get(stream, uri, settings);
  }
  Tcp::socket stream(context);
  return http_get(stream, uri, settings);
}

std::vector<Json> parse_targets(const Settings& settings) {
  const auto response = Json::parse(fetch_targets(settings));
  if (!response.contains("results") || !response.at("results").is_array()) throw std::runtime_error("Worker target server list is invalid");
  return response.at("results").get<std::vector<Json>>();
}

std::vector<Mapping> load_config(const Json& config, const Settings& settings, const std::vector<Json>& targets) {
  if (!config.contains("mappings") || !config.at("mappings").is_array()) throw std::runtime_error("config must contain a mappings array");
  std::vector<Mapping> mappings;
  std::vector<uint16_t> ports;
  for (const auto& item : config.at("mappings")) {
    Mapping mapping;
    mapping.name = item.value("name", std::string());
    mapping.protocol = item.value("protocol", std::string("tcp"));
    mapping.target_server_id = item.value("targetServerId", std::string());
    mapping.target_server_name = item.value("targetServerName", std::string());
    mapping.target_host = item.value("targetHost", std::string());
    mapping.enabled = item.value("enabled", true);
    if (mapping.target_server_id.empty() && !mapping.target_server_name.empty()) {
      std::vector<Json> matches;
      for (const auto& target : targets) if (target.value("name", std::string()) == mapping.target_server_name) matches.push_back(target);
      if (matches.size() != 1) throw std::runtime_error("targetServerName must match exactly one server: " + mapping.target_server_name);
      mapping.target_server_id = matches.front().at("id").get<std::string>();
    }
    if (mapping.name.empty() || mapping.target_server_id.empty() || mapping.target_host.empty() ||
        (mapping.protocol != "tcp" && mapping.protocol != "http" && mapping.protocol != "websocket") ||
        !read_port(item, "listenPort", mapping.listen_port) || !read_port(item, "targetPort", mapping.target_port)) {
      throw std::runtime_error("mapping requires name, protocol, listenPort, targetServerName or targetServerId, targetHost and targetPort");
    }
    if (mapping.target_host.find_first_of("\r\n\t /\\?#") != std::string::npos) throw std::runtime_error("targetHost contains invalid characters");
    if (mapping.target_server_id == settings.source_server_id) throw std::runtime_error("a tunnel target must be a different plugin server");
    const auto target = std::find_if(targets.begin(), targets.end(), [&mapping](const Json& value) { return value.value("id", std::string()) == mapping.target_server_id; });
    if (target == targets.end()) throw std::runtime_error("target plugin server is not available in this workspace");
    mapping.target_server_name = target->value("name", mapping.target_server_id);
    if (std::find(ports.begin(), ports.end(), mapping.listen_port) != ports.end()) throw std::runtime_error("listen ports must be unique");
    ports.push_back(mapping.listen_port);
    mappings.push_back(std::move(mapping));
  }
  return mappings;
}

template <typename Client>
void run_tunnel(Client& client, Tcp::socket& local, const Settings& settings, const Mapping& mapping, const WorkerUri& worker_uri, const std::function<void()>& authorization_complete) {
  client.clear_access_channels(websocketpp::log::alevel::all);
  client.clear_error_channels(websocketpp::log::elevel::all);
  client.init_asio();
  auto state = std::make_shared<TunnelState>();
  state->local = &local;
  const auto tunnel_url = std::string(worker_uri.secure ? "wss://" : "ws://") +
      (worker_uri.host.find(':') == std::string::npos ? worker_uri.host : "[" + worker_uri.host + "]") +
      (worker_uri.port == (worker_uri.secure ? "443" : "80") ? "" : ":" + worker_uri.port) +
      "/control/tunnel/connect?serverId=" + url_encode(settings.source_server_id) +
      "&targetServerId=" + url_encode(mapping.target_server_id) + "&targetHost=" + url_encode(mapping.target_host) +
      "&targetPort=" + std::to_string(mapping.target_port) + "&protocol=" + url_encode(mapping.protocol);
  client.set_open_handler([&client, state](websocketpp::connection_hdl handle) {
    (void)client;
    (void)handle;
    std::lock_guard lock(state->mutex);
    state->changed.notify_all();
  });
  auto password = mapping.target_password ? mapping.target_password : std::make_shared<std::string>();
  TunnelPasswordGuard password_guard{password};
  client.set_message_handler([&client, state, password, settings, mapping, authorization_complete](websocketpp::connection_hdl handle, typename Client::message_ptr message) {
    if (message->get_opcode() != websocketpp::frame::opcode::binary) {
      std::lock_guard lock(state->mutex);
      state->failed = true;
      state->failure = "Worker tunnel sent a non-binary frame";
      state->changed.notify_all();
      return;
    }
    const auto raw = message->get_payload();
    uint8_t type = 0;
    std::string payload;
    if (!plugmesh::tunnel::parse(raw, type, payload)) {
      std::lock_guard lock(state->mutex);
      state->failed = true;
      state->failure = "Worker tunnel protocol version is not supported";
      state->changed.notify_all();
      return;
    }
    if (type == plugmesh::tunnel::kSessionId) {
      std::lock_guard lock(state->mutex);
      state->session_id = payload;
      state->changed.notify_all();
      return;
    }
    if (type == plugmesh::tunnel::kPasswordRequired) {
      if (password->empty() || password->size() > 1024) {
        std::lock_guard lock(state->mutex);
        state->failed = true;
        state->failure = "target server password is required for initial authorization";
        state->changed.notify_all();
        client.close(handle, websocketpp::close::status::policy_violation, "Target authorization required");
        return;
      }
      try {
        const auto challenge = Json::parse(payload);
        const auto context = settings.source_server_id + "\n" + mapping.target_server_id + "\n" + state->session_id;
        std::string proof;
        std::string proof_error;
        if (state->session_id.empty() || !plugmesh::make_local_ui_password_proof(*password, challenge, context, proof, proof_error)) {
          std::lock_guard lock(state->mutex);
          state->failed = true;
          state->failure = "target authorization proof could not be created";
          state->changed.notify_all();
          client.close(handle, websocketpp::close::status::policy_violation, "Target authorization failed");
          return;
        }
        websocketpp::lib::error_code send_error;
        client.send(handle, plugmesh::tunnel::frame(plugmesh::tunnel::kAuthenticate, proof), websocketpp::frame::opcode::binary, send_error);
        if (send_error) {
          std::lock_guard lock(state->mutex);
          state->failed = true;
          state->failure = "unable to send target authorization proof";
          state->changed.notify_all();
        }
      } catch (...) {
        std::lock_guard lock(state->mutex);
        state->failed = true;
        state->failure = "target authorization challenge is invalid";
        state->changed.notify_all();
      }
      return;
    }
    if (type == plugmesh::tunnel::kAuthResult) {
      if (payload.size() != 1 || payload[0] != '\1') {
        std::lock_guard lock(state->mutex);
        state->failed = true;
        state->failure = "target plugin server rejected the login password";
      } else {
        std::lock_guard lock(state->mutex);
        state->ready = true;
        if (!password->empty()) {
          OPENSSL_cleanse(password->data(), password->size());
          password->clear();
          if (authorization_complete) authorization_complete();
        }
      }
      state->changed.notify_all();
      return;
    }
    if (type == plugmesh::tunnel::kReady) {
      if (!password->empty()) {
        OPENSSL_cleanse(password->data(), password->size());
        password->clear();
        if (authorization_complete) authorization_complete();
      }
      std::lock_guard lock(state->mutex);
      state->ready = true;
      state->changed.notify_all();
      return;
    }
    if (type == plugmesh::tunnel::kFin) {
      asio::error_code ignored;
      state->local->shutdown(Tcp::socket::shutdown_send, ignored);
      std::lock_guard lock(state->mutex);
      state->remote_fin = true;
      state->changed.notify_all();
      return;
    }
    if (type != plugmesh::tunnel::kData) {
      std::lock_guard lock(state->mutex);
      state->failed = true;
      state->failure = "Worker tunnel sent an unknown frame type";
      state->changed.notify_all();
      return;
    }
    asio::error_code write_error;
    if (!payload.empty()) asio::write(*state->local, asio::buffer(payload), write_error);
    if (write_error) {
      std::lock_guard lock(state->mutex);
      state->failed = true;
      state->failure = "unable to write data to local TCP client";
      state->changed.notify_all();
    }
  });
  client.set_close_handler([state](websocketpp::connection_hdl) {
    std::lock_guard lock(state->mutex);
    if (!state->remote_fin && !state->local_fin) {
      state->failed = true;
      if (state->failure.empty()) state->failure = "Worker tunnel closed";
    }
    state->changed.notify_all();
  });
  client.set_fail_handler([&client, state](websocketpp::connection_hdl handle) {
    const auto failed = client.get_con_from_hdl(handle);
    std::lock_guard lock(state->mutex);
    state->failed = true;
    state->failure = "Worker tunnel connection failed: " + failed->get_ec().message();
    state->changed.notify_all();
  });
  if constexpr (std::is_same_v<Client, TlsClient>) {
    const auto host = worker_uri.host;
    client.set_tls_init_handler([](websocketpp::connection_hdl) { return plugmesh::make_tls_context(); });
    client.set_socket_init_handler([host](websocketpp::connection_hdl, asio::ssl::stream<Tcp::socket>& socket) { plugmesh::configure_tls_socket(socket, host); });
  }

  websocketpp::lib::error_code connection_error;
  const auto connection = client.get_connection(tunnel_url, connection_error);
  if (connection_error) throw std::runtime_error("unable to create Worker tunnel connection");
  connection->append_header("Authorization", "Bearer " + settings.access_token);
  client.connect(connection);
  std::thread network([&client] { client.run(); });
  {
    std::unique_lock lock(state->mutex);
    if (!state->changed.wait_for(lock, std::chrono::seconds(20), [&] { return state->ready || state->failed; })) {
      state->failed = true;
      state->failure = "target plugin server authorization timed out";
    }
  }
  if (state->failed) {
    websocketpp::lib::error_code ignored;
    client.stop();
    if (network.joinable()) network.join();
    throw std::runtime_error(state->failure);
  }

  std::array<char, 16 * 1024> buffer{};
  asio::error_code read_error;
  while (!read_error) {
    const auto size = local.read_some(asio::buffer(buffer), read_error);
    if (size > 0) {
      const std::string payload(buffer.data(), size);
      websocketpp::lib::error_code send_error;
      client.send(connection->get_handle(), plugmesh::tunnel::frame(plugmesh::tunnel::kData, payload), websocketpp::frame::opcode::binary, send_error);
      if (send_error) {
        read_error = asio::error::operation_aborted;
        break;
      }
    }
  }
  if (read_error == asio::error::eof) {
    websocketpp::lib::error_code send_error;
    client.send(connection->get_handle(), plugmesh::tunnel::frame(plugmesh::tunnel::kFin), websocketpp::frame::opcode::binary, send_error);
    std::unique_lock lock(state->mutex);
    state->local_fin = true;
    state->changed.wait_for(lock, std::chrono::seconds(30), [&] { return state->remote_fin || state->failed; });
  }
  websocketpp::lib::error_code ignored;
  client.close(connection->get_handle(), websocketpp::close::status::normal, "TCP connection closed", ignored);
  local.close(read_error);
  client.stop();
  if (network.joinable()) network.join();
}

}  // namespace

namespace plugmesh {
namespace {

struct MappingListener {
  Mapping mapping;
  std::unique_ptr<asio::io_context> context;
  std::unique_ptr<Tcp::acceptor> acceptor;
  std::thread thread;
  std::vector<std::shared_ptr<Tcp::socket>> active_sockets;
  std::vector<std::thread> sessions;
};

}  // namespace

struct PortMapper::Impl {
  std::recursive_mutex lifecycle_mutex;
  std::atomic<bool> stopping{false};
  mutable std::mutex mutex;
  std::vector<std::unique_ptr<MappingListener>> listeners;
  Json state = Json::array();
  ServerConfig config;
  std::map<std::string, std::string> target_passwords;
  std::mutex password_mutex;

  void clear_target_password(const std::string& name) {
    std::lock_guard password_lock(password_mutex);
    const auto found = target_passwords.find(name);
    if (found == target_passwords.end()) return;
    OPENSSL_cleanse(found->second.data(), found->second.size());
    target_passwords.erase(found);
  }

  void stop() {
    stopping = true;
    for (auto& listener : listeners) {
      if (listener->thread.joinable()) listener->thread.join();
      for (const auto& socket : listener->active_sockets) {
#ifdef _WIN32
        ::shutdown(socket->native_handle(), SD_BOTH);
#else
        ::shutdown(socket->native_handle(), SHUT_RDWR);
#endif
      }
      for (auto& session : listener->sessions) if (session.joinable()) session.join();
      if (listener->acceptor) {
        asio::error_code ignored;
        listener->acceptor->close(ignored);
      }
    }
    listeners.clear();
  }
};

PortMapper::PortMapper() : impl_(std::make_unique<Impl>()) {}
PortMapper::~PortMapper() { stop(); }

bool PortMapper::start(const ServerConfig& server_config, std::string& error) {
  std::lock_guard lifecycle_lock(impl_->lifecycle_mutex);
  if (server_config.port_mappings_file.empty()) return true;
  if (!impl_->listeners.empty()) {
    error = "port mappings are already running";
    return false;
  }
  try {
    impl_->config = server_config;
    std::ifstream input(server_config.port_mappings_file);
    const auto config = input ? Json::parse(input) : Json{{"mappings", Json::array()}};
    const auto settings = load_settings(server_config);
    const auto uri = parse_worker_uri(settings.worker_url);
    const auto targets = config.at("mappings").empty() ? std::vector<Json>{} : parse_targets(settings);
    auto mappings = load_config(config, settings, targets);
    {
      std::lock_guard lock(impl_->mutex);
      impl_->state = Json::array();
      for (const auto& mapping : mappings) {
        impl_->state.push_back(Json{{"name", mapping.name}, {"protocol", mapping.protocol}, {"listenPort", mapping.listen_port}, {"targetServerId", mapping.target_server_id}, {"targetServer", mapping.target_server_name}, {"targetHost", mapping.target_host}, {"targetPort", mapping.target_port}, {"enabled", mapping.enabled}, {"state", mapping.enabled ? "listening" : "stopped"}});
      }
    }
    std::vector<std::unique_ptr<MappingListener>> listeners;
    for (auto& mapping : mappings) {
      if (!mapping.enabled) continue;
      std::lock_guard password_lock(impl_->password_mutex);
      if (const auto password = impl_->target_passwords.find(mapping.name); password != impl_->target_passwords.end()) mapping.target_password = std::make_shared<std::string>(password->second);
      auto listener = std::make_unique<MappingListener>();
      listener->mapping = std::move(mapping);
      listener->context = std::make_unique<asio::io_context>();
      listener->acceptor = std::make_unique<Tcp::acceptor>(*listener->context);
      const Tcp::endpoint endpoint(asio::ip::address_v4::loopback(), listener->mapping.listen_port);
      listener->acceptor->open(endpoint.protocol());
      listener->acceptor->set_option(Tcp::acceptor::reuse_address(false));
      listener->acceptor->bind(endpoint);
      listener->acceptor->listen(asio::socket_base::max_listen_connections);
      listener->acceptor->non_blocking(true);
      listeners.push_back(std::move(listener));
    }
    impl_->stopping = false;
    impl_->listeners = std::move(listeners);
    for (auto& listener : impl_->listeners) {
      auto* current = listener.get();
      const auto mapping = listener->mapping;
      listener->thread = std::thread([this, current, mapping, settings, uri] {
        while (!impl_->stopping) {
          auto incoming = std::make_shared<Tcp::socket>(*current->context);
          asio::error_code accept_error;
          current->acceptor->accept(*incoming, accept_error);
          if (accept_error == asio::error::would_block || accept_error == asio::error::try_again) {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
            continue;
          }
          if (accept_error) {
            if (!impl_->stopping) std::cerr << "plugmesh-server: mapping listener failed: " << accept_error.message() << '\n';
            break;
          }
          current->active_sockets.push_back(incoming);
          current->sessions.emplace_back([this, incoming, mapping, settings, uri] {
            const auto clear_password = [this, name = mapping.name, secret = mapping.target_password] {
              if (secret && !secret->empty()) {
                OPENSSL_cleanse(secret->data(), secret->size());
                secret->clear();
              }
              impl_->clear_target_password(name);
            };
            try {
              if (uri.secure) {
                TlsClient client;
                run_tunnel(client, *incoming, settings, mapping, uri, clear_password);
              } else {
                PlainClient client;
                run_tunnel(client, *incoming, settings, mapping, uri, clear_password);
              }
            } catch (const std::exception& session_error) {
              std::cerr << "plugmesh-server: mapped TCP session failed: " << session_error.what() << '\n';
            }
          });
        }
      });
    }
    return true;
  } catch (const std::exception& start_error) {
    impl_->stop();
    error = start_error.what();
    return false;
  }
}

void PortMapper::stop() {
  if (!impl_) return;
  std::lock_guard lifecycle_lock(impl_->lifecycle_mutex);
  impl_->stop();
}

std::string PortMapper::snapshot() const {
  std::lock_guard lock(impl_->mutex);
  return impl_->state.dump();
}

nlohmann::json PortMapper::handle_request(const std::string& method, const std::string& resource, const nlohmann::json& payload, std::string& error) {
  std::lock_guard lifecycle_lock(impl_->lifecycle_mutex);
  if (resource == "/api/mappings/targets" && method == "GET") {
    try { return Json{{"targets", parse_targets(load_settings(impl_->config))}}; }
    catch (const std::exception& exception) { error = exception.what(); return Json::object(); }
  }
  if (resource == "/api/mappings" && method == "GET") return Json{{"mappings", Json::parse(snapshot())}};
  if (impl_->config.port_mappings_file.empty()) {
    error = "mapping configuration path is unavailable";
    return Json::object();
  }

  const auto config_path = impl_->config.port_mappings_file;
  Json original{{"mappings", Json::array()}};
  {
    std::ifstream input(config_path);
    if (input) {
      try { original = Json::parse(input); }
      catch (...) { error = "mapping configuration is invalid"; return Json::object(); }
    }
  }
  auto config = original;
  auto& mappings = config["mappings"];
  if (!mappings.is_array()) { error = "mapping configuration is invalid"; return Json::object(); }
  const auto path_name = [&resource]() {
    constexpr std::string_view prefix = "/api/mappings/";
    return resource.rfind(prefix, 0) == 0 ? resource.substr(prefix.size()) : std::string();
  };
    const auto requested_name = payload.value("name", std::string());
  const auto submitted_password = payload.value("targetPassword", std::string());
  if (method == "POST" || method == "PUT") {
    auto item = payload;
    item.erase("targetPassword");
    const auto name = item.value("name", std::string());
    if (name.empty() || name.size() > 64 || name.find_first_not_of("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_") != std::string::npos) {
      error = "mapping name is invalid";
      return Json::object();
    }
    const auto existing_name = std::find_if(mappings.begin(), mappings.end(), [&name](const Json& value) { return value.value("name", std::string()) == name; });
    if (method == "POST") {
      if (existing_name != mappings.end()) { error = "mapping already exists"; return Json::object(); }
      mappings.push_back(item);
    } else {
      const auto existing_path = std::find_if(mappings.begin(), mappings.end(), [&path_name](const Json& value) { return value.value("name", std::string()) == path_name(); });
      if (path_name().empty() || existing_path == mappings.end()) { error = "mapping not found"; return Json::object(); }
      if (name != path_name() && existing_name != mappings.end()) { error = "mapping already exists"; return Json::object(); }
      *existing_path = item;
    }
  } else if (method == "DELETE") {
    const auto existing = std::find_if(mappings.begin(), mappings.end(), [&path_name](const Json& value) { return value.value("name", std::string()) == path_name(); });
    if (path_name().empty() || existing == mappings.end()) { error = "mapping not found"; return Json::object(); }
    mappings.erase(existing);
  } else {
    error = "unsupported mapping operation";
    return Json::object();
  }

  try {
    const auto settings = load_settings(impl_->config);
    const auto targets = mappings.empty() ? std::vector<Json>{} : parse_targets(settings);
    (void)load_config(config, settings, targets);
    std::filesystem::create_directories(config_path.parent_path());
    const auto temporary = config_path.string() + ".tmp";
    const auto backup = config_path.string() + ".bak";
    {
      std::ofstream output(temporary, std::ios::binary | std::ios::trunc);
      if (!output) throw std::runtime_error("cannot write mapping configuration");
      output << config.dump(2);
      output.close();
      if (!output) throw std::runtime_error("cannot flush mapping configuration");
    }
#if !defined(_WIN32)
    if (::chmod(temporary.c_str(), S_IRUSR | S_IWUSR) != 0) throw std::runtime_error("cannot protect mapping configuration");
#endif
    std::error_code filesystem_error;
    std::filesystem::remove(backup, filesystem_error);
    filesystem_error.clear();
    const bool had_original = std::filesystem::exists(config_path);
    if (had_original) {
      std::filesystem::rename(config_path, backup, filesystem_error);
      if (filesystem_error) throw std::runtime_error("cannot preserve current mapping configuration");
    }
    std::filesystem::rename(temporary, config_path, filesystem_error);
    if (filesystem_error) {
      if (had_original) std::filesystem::rename(backup, config_path, filesystem_error);
      throw std::runtime_error("cannot replace mapping configuration");
    }
    std::map<std::string, std::string> previous_passwords;
    {
      std::lock_guard password_lock(impl_->password_mutex);
      previous_passwords = impl_->target_passwords;
      if (method == "PUT" && requested_name != path_name()) {
        const auto old_password = impl_->target_passwords.find(path_name());
        if (old_password != impl_->target_passwords.end()) {
          impl_->target_passwords[requested_name] = std::move(old_password->second);
          impl_->target_passwords.erase(old_password);
        }
      }
      if (!submitted_password.empty()) impl_->target_passwords[requested_name] = submitted_password;
    }
    if (method == "DELETE") impl_->clear_target_password(path_name());
    stop();
    if (!start(impl_->config, error)) {
      std::filesystem::remove(config_path, filesystem_error);
      if (had_original) std::filesystem::rename(backup, config_path, filesystem_error);
      {
        std::lock_guard password_lock(impl_->password_mutex);
        for (auto& [stored_name, stored_password] : impl_->target_passwords) OPENSSL_cleanse(stored_password.data(), stored_password.size());
        impl_->target_passwords = previous_passwords;
      }
      std::string restore_error;
      if (!start(impl_->config, restore_error)) error += "; previous mappings could not be restarted: " + restore_error;
      return Json::object();
    }
    std::filesystem::remove(backup, filesystem_error);
    return Json{{"mappings", Json::parse(snapshot())}};
  } catch (const std::exception& exception) {
    error = exception.what();
    return Json::object();
  }
}

}  // namespace plugmesh
