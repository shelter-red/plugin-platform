#include "plugmesh/control_client.h"
#include "plugmesh/credential_store.h"
#include "plugmesh/embedded_ui.h"
#include "plugmesh/local_http_server.h"
#include "plugmesh/local_log_buffer.h"
#include "plugmesh/port_mapper.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/registration_client.h"
#include "plugmesh/server_config.h"

#include <cstdlib>
#include <cstdint>
#include <atomic>
#include <chrono>
#include <filesystem>
#include <iostream>
#include <string>
#include <thread>
#include <vector>

#ifdef _WIN32
#include <shellapi.h>
#include <windows.h>
#else
#include <termios.h>
#include <unistd.h>
#ifdef __APPLE__
#include <mach-o/dyld.h>
#else
#include <limits.h>
#endif
#endif

namespace {

std::string trim(std::string value) {
  const auto first = value.find_first_not_of(" \t\r\n");
  if (first == std::string::npos) return {};
  const auto last = value.find_last_not_of(" \t\r\n");
  return value.substr(first, last - first + 1);
}

std::string read_value(const char* environment_name, const char* prompt) {
  if (const char* value = std::getenv(environment_name); value && *value) return trim(value);
  std::cout << prompt << std::flush;
  std::string value;
  std::getline(std::cin, value);
  return trim(value);
}

// 无参数时从环境变量或交互式提示读取；供 `--register` 在无浏览器环境下使用。
std::string argument_or_prompt(int argc, char** argv, int index, const char* environment_name, const char* prompt) {
  if (argc > index && *argv[index]) return trim(argv[index]);
  return read_value(environment_name, prompt);
}

std::string read_secret(const char* environment_name, const char* prompt) {
  if (const char* value = std::getenv(environment_name); value && *value) return value;
  std::cout << prompt << std::flush;

#ifdef _WIN32
  const auto input = GetStdHandle(STD_INPUT_HANDLE);
  DWORD mode = 0;
  if (input != INVALID_HANDLE_VALUE && GetConsoleMode(input, &mode)) {
    SetConsoleMode(input, mode & ~ENABLE_ECHO_INPUT);
    std::string value;
    std::getline(std::cin, value);
    SetConsoleMode(input, mode);
    std::cout << '\n';
    return value;
  }
#else
  termios original{};
  if (tcgetattr(STDIN_FILENO, &original) == 0) {
    auto hidden = original;
    hidden.c_lflag &= static_cast<tcflag_t>(~ECHO);
    if (tcsetattr(STDIN_FILENO, TCSANOW, &hidden) == 0) {
      std::string value;
      std::getline(std::cin, value);
      tcsetattr(STDIN_FILENO, TCSANOW, &original);
      std::cout << '\n';
      return value;
    }
  }
#endif

  std::string value;
  std::getline(std::cin, value);
  return value;
}

bool read_local_ui_password(std::string& password, std::string& confirmation, std::string& error) {
  const auto* password_environment = std::getenv("PLUGMESH_LOCAL_UI_PASSWORD");
  const auto password_from_environment = password_environment && *password_environment;
  for (;;) {
    password = read_secret("PLUGMESH_LOCAL_UI_PASSWORD", "Local UI password: ");
    confirmation = password_from_environment ? password : read_secret("PLUGMESH_LOCAL_UI_PASSWORD_CONFIRMATION", "Confirm local UI password: ");
    if (password.size() >= 8 && password == confirmation) return true;
    error = password.size() < 8 ? "local UI password must contain at least 8 characters" : "local UI password confirmation does not match";
    std::cerr << "plugmesh-server: " << error << "; please enter it again\n";
    if (password_from_environment || std::cin.eof()) return false;
  }
}

bool read_required_secret(const char* environment_name, const char* prompt, std::string& value, std::string& error) {
  for (;;) {
    value = read_secret(environment_name, prompt);
    if (!value.empty()) return true;
    error = "credential file password is required";
    std::cerr << "plugmesh-server: " << error << "; please enter it again\n";
    if (std::cin.eof()) return false;
  }
}

uint16_t local_port() {
  const char* value = std::getenv("PLUGMESH_LOCAL_PORT");
  if (!value || !*value) return 8787;
  char* end = nullptr;
  const auto parsed = std::strtoul(value, &end, 10);
  return end != value && *end == '\0' && parsed > 0 && parsed <= 65535 ? static_cast<uint16_t>(parsed) : 8787;
}

#ifdef __ANDROID__
std::filesystem::path android_executable_path(const char* argv0) {
  if (!argv0 || !*argv0) return {};

  const auto canonical_file = [](const std::filesystem::path& candidate) {
    std::error_code error;
    const auto resolved = std::filesystem::canonical(candidate, error);
    if (error) return std::filesystem::path{};
    if (!std::filesystem::is_regular_file(resolved, error) || error) return std::filesystem::path{};
    return resolved;
  };

  const std::filesystem::path argument(argv0);
  if (argument.is_absolute()) return canonical_file(argument);
  if (argument.has_parent_path()) {
    std::error_code error;
    const auto current = std::filesystem::current_path(error);
    return error ? std::filesystem::path{} : canonical_file(current / argument);
  }

  if (const char* path_environment = std::getenv("PATH"); path_environment && *path_environment) {
    const std::string directories(path_environment);
    std::size_t start = 0;
    while (start <= directories.size()) {
      const auto end = directories.find(':', start);
      const auto entry = directories.substr(start, end == std::string::npos ? std::string::npos : end - start);
      std::error_code error;
      const auto directory = entry.empty() ? std::filesystem::current_path(error) : std::filesystem::path(entry);
      if (!error) {
        const auto resolved = canonical_file(directory / argument);
        if (!resolved.empty()) return resolved;
      }
      if (end == std::string::npos) break;
      start = end + 1;
    }
  }

  std::error_code error;
  const auto current = std::filesystem::current_path(error);
  return error ? std::filesystem::path{} : canonical_file(current / argument);
}
#endif

std::filesystem::path executable_directory(const char* argv0 = nullptr) {
#ifndef __ANDROID__
  (void)argv0;
#endif
#ifdef _WIN32
  std::wstring buffer(32768, L'\0');
  const auto length = GetModuleFileNameW(nullptr, buffer.data(), static_cast<DWORD>(buffer.size()));
  if (length != 0 && length < buffer.size()) {
    buffer.resize(length);
    return std::filesystem::path(buffer).parent_path();
  }
#elif defined(__APPLE__)
  uint32_t size = 0;
  _NSGetExecutablePath(nullptr, &size);
  std::vector<char> buffer(size > 0 ? size : 1);
  if (_NSGetExecutablePath(buffer.data(), &size) == 0) {
    std::error_code error;
    const auto executable = std::filesystem::weakly_canonical(buffer.data(), error);
    if (!error) return executable.parent_path();
  }
#elif defined(__ANDROID__)
  const auto executable = android_executable_path(argv0);
  if (!executable.empty()) return executable.parent_path();
#else
  char buffer[PATH_MAX]{};
  const auto length = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
  if (length > 0) {
    buffer[length] = '\0';
    return std::filesystem::path(buffer).parent_path();
  }
#endif
  std::error_code error;
  const auto current = std::filesystem::current_path(error);
  return error ? std::filesystem::path{} : current;
}

std::filesystem::path default_log_file() {
#ifdef _WIN32
  if (const char* directory = std::getenv("LOCALAPPDATA"); directory && *directory) return std::filesystem::path(directory) / "Plugmesh" / "logs" / "worker-communication.jsonl";
#elif defined(__APPLE__)
  if (const char* home = std::getenv("HOME"); home && *home) return std::filesystem::path(home) / "Library" / "Logs" / "Plugmesh" / "worker-communication.jsonl";
#else
  if (const char* state = std::getenv("XDG_STATE_HOME"); state && *state) return std::filesystem::path(state) / "plugmesh" / "worker-communication.jsonl";
  if (const char* home = std::getenv("HOME"); home && *home) return std::filesystem::path(home) / ".local" / "state" / "plugmesh" / "worker-communication.jsonl";
#endif
  return executable_directory() / "logs" / "worker-communication.jsonl";
}

std::filesystem::path local_ui_directory() {
  if (const char* value = std::getenv("PLUGMESH_LOCAL_UI_DIRECTORY"); value && *value) return value;
#ifdef _WIN32
  if (const char* data = std::getenv("LOCALAPPDATA"); data && *data) return std::filesystem::path(data) / "Plugmesh" / "native-ui" / "dist";
#elif defined(__APPLE__)
  if (const char* home = std::getenv("HOME"); home && *home) return std::filesystem::path(home) / "Library" / "Application Support" / "Plugmesh" / "native-ui" / "dist";
#else
  if (const char* data = std::getenv("XDG_DATA_HOME"); data && *data && std::filesystem::path(data).is_absolute()) return std::filesystem::path(data) / "plugmesh" / "native-ui" / "dist";
  if (const char* home = std::getenv("HOME"); home && *home) return std::filesystem::path(home) / ".local" / "share" / "plugmesh" / "native-ui" / "dist";
#endif
  return executable_directory() / "native-ui" / "dist";
}

std::filesystem::path default_credential_file() {
#ifdef _WIN32
  if (const char* data = std::getenv("LOCALAPPDATA"); data && *data) return std::filesystem::path(data) / "Plugmesh" / "credentials.json";
#elif defined(__APPLE__)
  if (const char* home = std::getenv("HOME"); home && *home) return std::filesystem::path(home) / "Library" / "Application Support" / "Plugmesh" / "credentials.json";
#else
  if (const char* home = std::getenv("HOME"); home && *home) return std::filesystem::path(home) / ".config" / "plugmesh" / "credentials.json";
#endif
  return executable_directory() / "plugmesh-credentials.json";
}

void open_local_setup_browser(uint16_t port) {
  const auto url = std::string("http://127.0.0.1:") + std::to_string(port) + "/";
#ifdef _WIN32
  const auto wide_url = std::filesystem::path(url).wstring();
  ShellExecuteW(nullptr, L"open", wide_url.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
#elif defined(__APPLE__)
  std::system(("open " + url + " >/dev/null 2>&1 &").c_str());
#else
  std::system(("xdg-open " + url + " >/dev/null 2>&1 &").c_str());
#endif
}

bool run_registration_setup(plugmesh::ServerConfig& config, uint16_t port, const std::filesystem::path& ui_directory, std::string& error) {
  const auto initial_credential_file = config.credential_file.string();
  std::atomic<bool> registration_complete{false};
  std::atomic<bool> callback_active{false};
  std::atomic<bool> server_failed{false};
  bool registered = false;
  std::string server_error;
  plugmesh::LocalHttpServer local_http(port, nullptr, [initial_credential_file] {
    return nlohmann::json{{"configured", false}, {"connected", false}, {"credentialFile", initial_credential_file}, {"systemCredentialsAvailable", plugmesh::system_credentials_available()}};
  }, ui_directory, [&config, &registration_complete, &callback_active, &registered](const nlohmann::json& payload, std::string& callback_error, std::string& callback_error_code) {
    callback_active = true;
    const auto text = [&](const char* key) {
      return payload.contains(key) && payload.at(key).is_string() ? payload.at(key).get<std::string>() : std::string();
    };
    const auto worker_url = text("workerUrl");
    const auto server_name = text("serverName");
    const auto code = text("registrationCode");
    std::string password = text("credentialPassword");
    const auto local_ui_password = text("localUiPassword");
    const auto local_ui_password_confirmation = text("localUiPasswordConfirmation");
    const auto credential_file = text("credentialFile").empty() ? config.credential_file.string() : text("credentialFile");
    const auto resolved_credential_file = credential_file.empty() ? default_credential_file() : std::filesystem::path(credential_file);
     const auto key_file = config.credential_key_file.empty() ? std::filesystem::path(resolved_credential_file.string() + ".key") : config.credential_key_file;
     if (password.empty() && !plugmesh::ensure_credential_key(key_file, password, callback_error)) {
       callback_error_code = "credential_save_failed";
       callback_active = false;
       return nlohmann::json::object();
     }
     const auto use_system_store = false;
    if (worker_url.empty() || server_name.empty() || code.empty() || local_ui_password.size() < 8 || local_ui_password != local_ui_password_confirmation || (!use_system_store && password.empty()) || (use_system_store && !plugmesh::system_credentials_available())) {
      if (local_ui_password.size() < 8) callback_error = "本地 UI 口令至少需要 8 个字符";
      else if (local_ui_password != local_ui_password_confirmation) callback_error = "本地 UI 口令与确认口令不一致";
      else callback_error = use_system_store ? "当前平台没有可用的系统凭据存储，请填写凭据文件路径和口令" : "Worker 地址、服务器名称、注册码、凭据口令和凭据文件路径均为必填";
      callback_error_code = "registration_invalid_input";
      callback_active = false;
      return nlohmann::json::object();
    }

    std::string local_ui_password_verifier;
    if (!plugmesh::make_local_ui_password_verifier(local_ui_password, local_ui_password_verifier, callback_error)) {
      callback_error_code = "credential_save_failed";
      callback_active = false;
      return nlohmann::json::object();
    }

    plugmesh::RegistrationResult registration;
    plugmesh::RegistrationFailure registration_failure = plugmesh::RegistrationFailure::none;
    if (!plugmesh::register_server(worker_url, code, server_name, registration, callback_error, &registration_failure)) {
      callback_error_code = plugmesh::registration_failure_code(registration_failure);
      callback_active = false;
      return nlohmann::json::object();
    }
    const plugmesh::StoredCredentials credentials{worker_url, registration.server_id, registration.access_token, local_ui_password_verifier};
    if (!plugmesh::save_credentials(resolved_credential_file, credentials, password, callback_error)) {
      callback_error_code = "credential_save_failed";
      callback_active = false;
      return nlohmann::json::object();
    }

    config.worker_url = worker_url;
    config.server_id = registration.server_id;
    config.access_token = registration.access_token;
    config.local_ui_password_verifier = local_ui_password_verifier;
    config.credential_file = resolved_credential_file;
     config.credential_key_file = key_file;
    registered = true;
    callback_active = false;
    registration_complete = true;
    return nlohmann::json{{"serverId", registration.server_id}, {"credentialFile", resolved_credential_file.string()}};
  });
  std::thread local_thread([&local_http, &server_error, &server_failed] {
    if (!local_http.run(server_error)) {
      server_failed = true;
      if (!server_error.empty()) std::cerr << "plugmesh-server local setup: " << server_error << '\n';
    }
  });
  for (int attempt = 0; attempt < 100 && !local_http.is_running() && !server_failed; ++attempt) {
    std::this_thread::sleep_for(std::chrono::milliseconds(10));
  }
  if (local_http.is_running()) {
    const auto actual_port = local_http.port();
    if (actual_port != port) std::cout << "plugmesh-server: local port " << port << " is in use; using " << actual_port << "\n";
    std::cout << "plugmesh-server: local setup available at http://127.0.0.1:" << actual_port << "/\n";
    open_local_setup_browser(actual_port);
  }
  while ((!registration_complete || callback_active || local_http.has_active_requests()) && !server_failed) std::this_thread::sleep_for(std::chrono::milliseconds(10));
  // 注册回调可能已经完成，但 HTTP 响应仍在 websocketpp 的处理栈中；
  // 等请求退出后再销毁监听器，避免 Windows 下 teardown 期间访问已释放连接。
  local_http.stop();
  if (local_thread.joinable()) local_thread.join();
  // run() 在主动 stop() 时同样返回 false；只要注册已经完成就算成功，
  // 否则重新绑定后进程会误判为启动失败并退出。
  if (!registered) {
    error = server_failed ? (server_error.empty() ? "local setup server stopped unexpectedly" : server_error) : "local registration did not complete";
    return false;
  }
  return true;
}

int register_server(int argc, char** argv) {
  if (argc > 5) {
    std::cerr << "usage: plugmesh-server --register [<worker-url> <server-name> <credential-file>]\n"
                 "省略参数时依次从 PLUGMESH_WORKER_URL、PLUGMESH_SERVER_NAME、PLUGMESH_CREDENTIAL_FILE 或交互式提示读取。\n";
    return 2;
  }
  const auto worker_url = argument_or_prompt(argc, argv, 2, "PLUGMESH_WORKER_URL", "Worker URL: ");
  const auto server_name = argument_or_prompt(argc, argv, 3, "PLUGMESH_SERVER_NAME", "Server name: ");
  const auto credential_file = argc > 4 ? argument_or_prompt(argc, argv, 4, "PLUGMESH_CREDENTIAL_FILE", "Credential file: ") : default_credential_file().string();
  if (worker_url.empty() || server_name.empty() || credential_file.empty()) {
    std::cerr << "plugmesh-server: worker URL, server name and credential file are required\n";
    return 2;
  }
  const auto code = read_value("PLUGMESH_REGISTRATION_CODE", "Registration code: ");
  std::string local_ui_password;
  std::string local_ui_password_confirmation;
  std::string local_ui_password_verifier;
  std::string error;
  if (!read_local_ui_password(local_ui_password, local_ui_password_confirmation, error)) return 2;
  if (!plugmesh::make_local_ui_password_verifier(local_ui_password, local_ui_password_verifier, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  std::string password;
  const auto key_file = std::filesystem::path(credential_file + ".key");
  if (const char* configured_password = std::getenv("PLUGMESH_CREDENTIAL_PASSWORD"); configured_password && *configured_password) password = configured_password;
  else if (!plugmesh::ensure_credential_key(key_file, password, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  plugmesh::RegistrationResult registration;
  if (!plugmesh::register_server(worker_url, code, server_name, registration, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  const plugmesh::StoredCredentials credentials{worker_url, registration.server_id, registration.access_token, local_ui_password_verifier};
  if (!plugmesh::save_credentials(credential_file, credentials, password, error)) {
    std::cerr << "plugmesh-server: " << error << '\n';
    return 1;
  }
  std::cout << "server registered as " << registration.server_id << "\n";
  std::cout << "credentials saved to " << credential_file << "\n";
  return 0;
}

}  // namespace

int main(int argc, char** argv) {
  if (argc > 1 && std::string(argv[1]) == "--register") return register_server(argc, argv);
  const auto ui_directory = local_ui_directory();
  std::string ui_error;
  if (!plugmesh::extract_embedded_ui(ui_directory, ui_error)) {
    std::cerr << "plugmesh-server: unable to prepare embedded Native UI: " << ui_error << '\n';
    return 2;
  }
  const auto config = plugmesh::load_config_from_environment();
  auto resolved_config = config;
  if (resolved_config.credential_file.empty()) resolved_config.credential_file = default_credential_file();
  if (resolved_config.credential_key_file.empty()) resolved_config.credential_key_file = resolved_config.credential_file.string() + ".key";
  std::string plugin_directory_error;
  if (!plugmesh::prepare_executable_plugin_directory(resolved_config, executable_directory(argc > 0 ? argv[0] : nullptr), plugin_directory_error)) {
    std::cerr << "plugmesh-server: " << plugin_directory_error << '\n';
    return 2;
  }
  while (true) {
    std::string error;
    if (!plugmesh::load_persisted_config(resolved_config, error) || !plugmesh::validate_binding_config(resolved_config, error)) {
      std::cerr << "plugmesh-server: entering local setup (" << error << ")\n";
      if (!run_registration_setup(resolved_config, local_port(), ui_directory, error)) {
        std::cerr << "plugmesh-server: " << error << '\n';
        return 2;
      }
    }
    if (!plugmesh::validate_config(resolved_config, error)) {
      std::cerr << "plugmesh-server: " << error << '\n';
      return 2;
    }
    const auto log_file = std::getenv("PLUGMESH_LOG_FILE") && *std::getenv("PLUGMESH_LOG_FILE")
        ? std::filesystem::path(std::getenv("PLUGMESH_LOG_FILE"))
        : default_log_file();
    if (resolved_config.tunnel_trust_file.empty()) resolved_config.tunnel_trust_file = log_file.parent_path() / "tunnel-authorizations.json";
    if (resolved_config.port_mappings_file.empty()) resolved_config.port_mappings_file = log_file.parent_path() / "port-mappings.json";
    plugmesh::LocalLogBuffer logs(log_file);
    plugmesh::PluginManager plugins;
    plugins.set_log_writer([&logs](int level, const char* message) { logs.append(level, message); });
    if (!plugins.discover(resolved_config.plugin_directory, error)) {
      std::cerr << "plugmesh-server: " << error << '\n';
      return 2;
    }
    std::cout << "plugmesh-server discovered " << plugins.snapshot().size() << " plugin(s) for " << resolved_config.server_id << '\n';
    plugmesh::ControlClient client(resolved_config, plugins, [&logs](int level, const std::string& message) { logs.append_communication(level, message.c_str()); });
    plugmesh::PortMapper port_mapper;
    if (!port_mapper.start(resolved_config, error)) {
      std::cerr << "plugmesh-server: unable to start port mappings: " << error << '\n';
      return 2;
    }
        client.set_server_info_provider([&port_mapper] { return nlohmann::json{{"portMappings", nlohmann::json::parse(port_mapper.snapshot())}}; });

    std::atomic<bool> rebind_requested{false};
    std::atomic<bool> credential_action_active{false};
    const auto preferred_local_port = local_port();
    plugmesh::LocalHttpServer local_http(preferred_local_port, &plugins, [&client, &resolved_config, &port_mapper] {
      return nlohmann::json{{"configured", true}, {"serverId", resolved_config.server_id}, {"workerUrl", resolved_config.worker_url}, {"credentialFile", resolved_config.credential_file.string()}, {"portMappingsFile", resolved_config.port_mappings_file.string()}, {"portMappings", nlohmann::json::parse(port_mapper.snapshot())}, {"systemCredentialsAvailable", plugmesh::system_credentials_available()}, {"connected", client.connected()}};
    }, ui_directory, {}, [&logs] { return logs.snapshot(); }, [&client, &resolved_config, &rebind_requested, &credential_action_active](const std::string& action, const nlohmann::json& payload, std::string& action_error) {
      credential_action_active = true;
      struct ActionGuard {
        std::atomic<bool>& active;
        ~ActionGuard() { active = false; }
      } guard{credential_action_active};
      const auto password = payload.value("credentialPassword", std::string());
      if (!resolved_config.credential_file.empty() && password.empty()) {
        action_error = "凭据文件模式必须提供凭据口令";
        return nlohmann::json::object();
      }
      if (action == "rotate") {
        std::string access_token;
        if (!client.rotate_access_token(access_token, action_error)) return nlohmann::json::object();
        const plugmesh::StoredCredentials credentials{resolved_config.worker_url, resolved_config.server_id, access_token, resolved_config.local_ui_password_verifier};
        if (!plugmesh::save_credentials(resolved_config.credential_file, credentials, password, action_error)) return nlohmann::json::object();
        resolved_config.access_token = access_token;
        return nlohmann::json{{"storage", resolved_config.credential_file.empty() ? "system" : "file"}};
      }
      if (action == "revoke") {
        if (!client.revoke_binding(action_error)) return nlohmann::json::object();
        if (!plugmesh::remove_credentials(resolved_config.credential_file, action_error)) return nlohmann::json::object();
        resolved_config.local_ui_password_verifier.clear();
        rebind_requested = true;
        client.stop();
        return nlohmann::json{{"rebindRequired", true}};
      }
      action_error = "unknown credential action";
      return nlohmann::json::object();
    }, resolved_config.local_ui_password_verifier, [&resolved_config](const std::string& verifier, const nlohmann::json& payload, std::string& setup_error) {
      auto credential_password = payload.value("credentialPassword", std::string());
      if (credential_password.empty()) {
        if (const char* environment_password = std::getenv("PLUGMESH_CREDENTIAL_PASSWORD"); environment_password) credential_password = environment_password;
      }
      if (!resolved_config.credential_file.empty() && credential_password.empty()) {
        setup_error = "凭据文件模式必须提供凭据口令";
        return false;
      }
      const plugmesh::StoredCredentials credentials{resolved_config.worker_url, resolved_config.server_id, resolved_config.access_token, verifier};
      if (!plugmesh::save_credentials(resolved_config.credential_file, credentials, credential_password, setup_error)) return false;
      resolved_config.local_ui_password_verifier = verifier;
      return true;
    }, [&port_mapper](const std::string& method, const std::string& resource, const nlohmann::json& payload, std::string& mapping_error) {
      return port_mapper.handle_request(method, resource, payload, mapping_error);
    });
    std::string local_error;
    std::atomic<bool> local_failed{false};
    std::thread local_thread([&local_http, &local_error, &local_failed] {
      if (!local_http.run(local_error)) {
        local_failed = true;
        if (!local_error.empty()) std::cerr << "plugmesh-server local UI: " << local_error << '\n';
      }
    });
    for (int attempt = 0; attempt < 100 && !local_http.is_running() && !local_failed; ++attempt) {
      std::this_thread::sleep_for(std::chrono::milliseconds(10));
    }
    if (local_http.is_running()) {
      const auto actual_port = local_http.port();
      if (actual_port != preferred_local_port) std::cout << "plugmesh-server: local port " << preferred_local_port << " is in use; using " << actual_port << "\n";
      std::cout << "plugmesh-server: local UI available at http://127.0.0.1:" << actual_port << "/\n";
    }
    const auto connected = client.run(error);
    port_mapper.stop();
    while (credential_action_active || local_http.has_active_requests()) std::this_thread::sleep_for(std::chrono::milliseconds(10));
    local_http.stop();
    if (local_thread.joinable()) local_thread.join();
    if (rebind_requested) {
      resolved_config.worker_url.clear();
      resolved_config.server_id.clear();
      resolved_config.access_token.clear();
      resolved_config.local_ui_password_verifier.clear();
      continue;
    }
    if (!connected) {
      std::cerr << "plugmesh-server: " << error << '\n';
      return 1;
    }
    return 0;
  }
}
