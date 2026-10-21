#include "plugmesh/local_http_server.h"
#include "plugmesh/credential_store.h"

#include <asio.hpp>
#include <nlohmann/json.hpp>

#include <algorithm>
#include <chrono>
#include <cctype>
#include <cstdint>
#include <cstdlib>
#include <iostream>
#include <iterator>
#include <map>
#include <sstream>
#include <string>
#include <thread>

namespace {

using Json = nlohmann::json;
using Tcp = asio::ip::tcp;

struct HttpResponse {
  int status = 0;
  std::map<std::string, std::string> headers;
  std::string body;
};

std::string lower(std::string value) {
  std::transform(value.begin(), value.end(), value.begin(), [](unsigned char character) {
    return static_cast<char>(std::tolower(character));
  });
  return value;
}

std::string trim(std::string value) {
  const auto first = value.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) return {};
  const auto last = value.find_last_not_of(" \t\r\n");
  return value.substr(first, last - first + 1);
}

bool http_request(uint16_t port, const std::string& method, const std::string& path, const std::string& body, const std::string& cookie, HttpResponse& response, std::string& error) {
  try {
    response = {};
    asio::io_context context;
    Tcp::resolver resolver(context);
    Tcp::socket socket(context);
    asio::connect(socket, resolver.resolve("127.0.0.1", std::to_string(port)));

    std::ostringstream request;
    request << method << ' ' << path << " HTTP/1.1\r\n"
            << "Host: 127.0.0.1\r\n"
            << "Connection: close\r\n"
            << "Content-Length: " << body.size() << "\r\n";
    if (!body.empty()) request << "Content-Type: application/json\r\n";
    if (!cookie.empty()) request << "Cookie: " << cookie << "\r\n";
    request << "\r\n" << body;
    const auto wire_request = request.str();
    asio::write(socket, asio::buffer(wire_request));

    asio::streambuf buffer;
    asio::read_until(socket, buffer, "\r\n\r\n");
    std::istream input(&buffer);
    std::string status_line;
    std::getline(input, status_line);
    std::istringstream status_parser(status_line);
    std::string version;
    if (!(status_parser >> version >> response.status)) {
      error = "invalid HTTP status line";
      return false;
    }

    std::string header_line;
    while (std::getline(input, header_line) && header_line != "\r") {
      const auto separator = header_line.find(':');
      if (separator == std::string::npos) continue;
      response.headers[lower(trim(header_line.substr(0, separator)))] = trim(header_line.substr(separator + 1));
    }

    const auto content_length = response.headers.find("content-length");
    if (content_length == response.headers.end()) {
      response.body.assign(std::istreambuf_iterator<char>(input), std::istreambuf_iterator<char>());
      return true;
    }

    const auto length = static_cast<std::size_t>(std::stoull(content_length->second));
    response.body.resize(length);
    const auto already_buffered = std::min(length, buffer.size());
    if (already_buffered > 0) input.read(response.body.data(), static_cast<std::streamsize>(already_buffered));
    if (already_buffered < length) asio::read(socket, asio::buffer(response.body.data() + already_buffered, length - already_buffered));
    return true;
  } catch (const std::exception& exception) {
    error = exception.what();
    return false;
  }
}

bool request_with_retry(uint16_t port, const std::string& method, const std::string& path, const std::string& body, const std::string& cookie, HttpResponse& response, std::string& error) {
  for (int attempt = 0; attempt < 40; ++attempt) {
    if (http_request(port, method, path, body, cookie, response, error)) return true;
    std::this_thread::sleep_for(std::chrono::milliseconds(25));
  }
  return false;
}

bool expect_status(const HttpResponse& response, int expected, const char* operation) {
  if (response.status == expected) return true;
  std::cerr << operation << " returned " << response.status << ", expected " << expected << '\n';
  return false;
}

std::string session_cookie(const HttpResponse& response) {
  const auto iterator = response.headers.find("set-cookie");
  if (iterator == response.headers.end()) return {};
  return iterator->second.substr(0, iterator->second.find(';'));
}

uint16_t available_port() {
  asio::io_context context;
  Tcp::acceptor acceptor(context, Tcp::endpoint(asio::ip::address_v4::loopback(), 0));
  const auto port = acceptor.local_endpoint().port();
  acceptor.close();
  return port;
}

bool run_authenticated_server(uint16_t port) {
  std::string verifier;
  std::string error;
  if (!plugmesh::make_local_ui_password_verifier("smoke-password", verifier, error)) {
    std::cerr << "password verifier setup failed: " << error << '\n';
    return false;
  }

  plugmesh::LocalHttpServer server(port, nullptr, [] {
    return Json{{"configured", true}, {"connected", false}};
  }, {}, {}, {}, {}, verifier);
  std::string server_error;
  std::thread server_thread([&] { server.run(server_error); });
  const auto stop_server = [&] {
    server.stop();
    if (server_thread.joinable()) server_thread.join();
  };

  HttpResponse response;
  if (!request_with_retry(port, "GET", "/api/session", "", "", response, error) || !expect_status(response, 200, "session status")) {
    stop_server();
    std::cerr << "session status request failed: " << (server_error.empty() ? error : server_error) << '\n';
    return false;
  }
  if (!Json::parse(response.body).value("passwordConfigured", false)) {
    stop_server();
    std::cerr << "configured session did not report a password\n";
    return false;
  }

  if (!http_request(port, "GET", "/api/status", "", "", response, error) || !expect_status(response, 401, "unauthenticated status")) {
    stop_server();
    return false;
  }
  if (!http_request(port, "POST", "/api/session", R"({"password":"wrong-password"})", "", response, error) || !expect_status(response, 401, "invalid login")) {
    stop_server();
    return false;
  }
  if (!http_request(port, "POST", "/api/session", R"({"password":"smoke-password"})", "", response, error) || !expect_status(response, 200, "valid login")) {
    stop_server();
    return false;
  }
  const auto cookie = session_cookie(response);
  if (cookie.empty()) {
    stop_server();
    std::cerr << "valid login did not issue a session cookie\n";
    return false;
  }
  if (!http_request(port, "GET", "/api/status", "", cookie, response, error) || !expect_status(response, 200, "authenticated status")) {
    stop_server();
    return false;
  }
  if (!http_request(port, "GET", "/api/plugins", "", cookie, response, error) || !expect_status(response, 200, "plugin list")) {
    stop_server();
    return false;
  }
  if (!http_request(port, "DELETE", "/api/session", "", cookie, response, error) || !expect_status(response, 200, "logout")) {
    stop_server();
    return false;
  }
  if (!http_request(port, "GET", "/api/status", "", "", response, error) || !expect_status(response, 401, "logged out status")) {
    stop_server();
    return false;
  }
  stop_server();
  return true;
}

bool run_password_setup_server(uint16_t port) {
  bool setup_called = false;
  plugmesh::LocalHttpServer server(port, nullptr, [] {
    return Json{{"configured", true}, {"connected", false}};
  }, {}, {}, {}, {}, {}, [&setup_called](const std::string& verifier, const Json&, std::string&) {
    setup_called = !verifier.empty();
    return setup_called;
  });
  std::string server_error;
  std::thread server_thread([&] { server.run(server_error); });
  const auto stop_server = [&] {
    server.stop();
    if (server_thread.joinable()) server_thread.join();
  };

  HttpResponse response;
  std::string error;
  if (!request_with_retry(port, "GET", "/api/session", "", "", response, error) || !expect_status(response, 200, "password setup status")) {
    stop_server();
    if (!server_error.empty()) std::cerr << "password setup server failed: " << server_error << '\n';
    return false;
  }
  if (!Json::parse(response.body).value("passwordSetupRequired", false)) {
    stop_server();
    std::cerr << "password setup status was not reported\n";
    return false;
  }
  if (!http_request(port, "POST", "/api/session/password", R"({"password":"new-password","passwordConfirmation":"new-password"})", "", response, error) || !expect_status(response, 200, "password setup")) {
    stop_server();
    return false;
  }
  if (!setup_called || session_cookie(response).empty()) {
    stop_server();
    std::cerr << "password setup did not save a session\n";
    return false;
  }
  stop_server();
  return true;
}

}  // namespace

int main() {
  const auto* configured_port_value = std::getenv("PLUGMESH_SMOKE_PORT");
  const auto authenticated_port = configured_port_value ? static_cast<uint16_t>(std::strtoul(configured_port_value, nullptr, 10)) : available_port();
  if (!run_authenticated_server(authenticated_port) || !run_password_setup_server(available_port())) return 1;
  std::cout << "local HTTP server smoke test passed\n";
  return 0;
}
