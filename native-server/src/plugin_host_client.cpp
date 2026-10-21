#include "plugmesh/plugin_host_client.h"

#include <cerrno>
#include <cstring>

#ifdef _WIN32
#include <windows.h>
#else
#include <csignal>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace plugmesh {

namespace {

std::string protocol_error(const std::string& message) { return "plugin host protocol error: " + message; }

}  // namespace

PluginHostClient::~PluginHostClient() { stop(); }

void PluginHostClient::set_event_handler(EventHandler handler) { event_handler_ = std::move(handler); }

#ifdef _WIN32

bool PluginHostClient::start(const std::filesystem::path& executable, const std::filesystem::path& library, std::string& error) {
  std::lock_guard lifecycle_lock(lifecycle_mutex_);
  if (running_) {
    error = "plugin host is already running";
    return false;
  }
  SECURITY_ATTRIBUTES attributes{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
  HANDLE child_stdin_read = nullptr;
  HANDLE child_stdin_write = nullptr;
  HANDLE child_stdout_read = nullptr;
  HANDLE child_stdout_write = nullptr;
  if (!CreatePipe(&child_stdin_read, &child_stdin_write, &attributes, 0) || !CreatePipe(&child_stdout_read, &child_stdout_write, &attributes, 0)) {
    error = "cannot create plugin host pipes";
    return false;
  }
  SetHandleInformation(child_stdin_write, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(child_stdout_read, HANDLE_FLAG_INHERIT, 0);
  STARTUPINFOA startup{};
  startup.cb = sizeof(startup);
  startup.dwFlags = STARTF_USESTDHANDLES;
  startup.hStdInput = child_stdin_read;
  startup.hStdOutput = child_stdout_write;
  startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
  PROCESS_INFORMATION process{};
  std::string command = "\"" + executable.string() + "\" \"" + library.string() + "\"";
  const bool created = CreateProcessA(nullptr, command.data(), nullptr, nullptr, TRUE, 0, nullptr, nullptr, &startup, &process) != 0;
  CloseHandle(child_stdin_read);
  CloseHandle(child_stdout_write);
  if (!created) {
    CloseHandle(child_stdin_write);
    CloseHandle(child_stdout_read);
    error = "cannot start plugin host: " + std::to_string(GetLastError());
    return false;
  }
  CloseHandle(process.hThread);
  process_ = process.hProcess;
  stdin_handle_ = child_stdin_write;
  stdout_handle_ = child_stdout_read;
  read_buffer_.clear();
  running_ = true;
  reader_ = std::thread([this] { reader_loop(); });
  return true;
}

bool PluginHostClient::write_line(const std::string& line, std::string& error) {
  std::lock_guard lock(write_mutex_);
  if (!running_ || !stdin_handle_) {
    error = "plugin host is not running";
    return false;
  }
  const std::string payload = line + "\n";
  DWORD written = 0;
  if (!WriteFile(static_cast<HANDLE>(stdin_handle_), payload.data(), static_cast<DWORD>(payload.size()), &written, nullptr) || written != payload.size()) {
    error = "cannot write to plugin host";
    running_ = false;
    return false;
  }
  return true;
}

bool PluginHostClient::read_line(std::string& line, std::string& error) {
  for (;;) {
    const auto newline = read_buffer_.find('\n');
    if (newline != std::string::npos) {
      line = read_buffer_.substr(0, newline);
      read_buffer_.erase(0, newline + 1);
      return true;
    }
    char buffer[4096];
    DWORD read = 0;
    if (!ReadFile(static_cast<HANDLE>(stdout_handle_), buffer, sizeof(buffer), &read, nullptr) || read == 0) {
      error = "plugin host exited unexpectedly";
      running_ = false;
      return false;
    }
    read_buffer_.append(buffer, read);
  }
}

bool PluginHostClient::alive() {
  if (!running_) return false;
  if (!process_) return false;
  if (WaitForSingleObject(static_cast<HANDLE>(process_), 0) == WAIT_TIMEOUT) return true;
  running_ = false;
  return false;
}

void PluginHostClient::close_stdin() {
  std::lock_guard lock(write_mutex_);
  if (stdin_handle_) {
    CloseHandle(static_cast<HANDLE>(stdin_handle_));
    stdin_handle_ = nullptr;
  }
}

void PluginHostClient::stop() {
  std::lock_guard lifecycle_lock(lifecycle_mutex_);
  if (running_) {
    std::string ignored;
    send_without_reply({{"op", "shutdown"}}, ignored);
  }
  running_ = false;
  close_stdin();
  if (process_) {
    if (WaitForSingleObject(static_cast<HANDLE>(process_), 500) == WAIT_TIMEOUT) {
      TerminateProcess(static_cast<HANDLE>(process_), 1);
      WaitForSingleObject(static_cast<HANDLE>(process_), 1000);
    }
  }
  if (reader_.joinable()) reader_.join();
  if (process_) {
    CloseHandle(static_cast<HANDLE>(process_));
    process_ = nullptr;
  }
  if (stdout_handle_) {
    CloseHandle(static_cast<HANDLE>(stdout_handle_));
    stdout_handle_ = nullptr;
  }
  read_buffer_.clear();
  fail_all_pending("plugin host stopped");
}

#else

bool PluginHostClient::start(const std::filesystem::path& executable, const std::filesystem::path& library, std::string& error) {
  std::lock_guard lifecycle_lock(lifecycle_mutex_);
  if (running_) {
    error = "plugin host is already running";
    return false;
  }
  int input_pipe[2] = {-1, -1};
  int output_pipe[2] = {-1, -1};
  if (pipe(input_pipe) != 0 || pipe(output_pipe) != 0) {
    error = "cannot create plugin host pipes: " + std::string(std::strerror(errno));
    return false;
  }
  const pid_t pid = fork();
  if (pid < 0) {
    error = "cannot fork plugin host: " + std::string(std::strerror(errno));
    close(input_pipe[0]);
    close(input_pipe[1]);
    close(output_pipe[0]);
    close(output_pipe[1]);
    return false;
  }
  if (pid == 0) {
    dup2(input_pipe[0], STDIN_FILENO);
    dup2(output_pipe[1], STDOUT_FILENO);
    close(input_pipe[0]);
    close(input_pipe[1]);
    close(output_pipe[0]);
    close(output_pipe[1]);
    execl(executable.c_str(), executable.c_str(), library.c_str(), static_cast<char*>(nullptr));
    _exit(127);
  }
  close(input_pipe[0]);
  close(output_pipe[1]);
  stdin_fd_ = input_pipe[1];
  stdout_fd_ = output_pipe[0];
  pid_ = static_cast<int>(pid);
  read_buffer_.clear();
  running_ = true;
  reader_ = std::thread([this] { reader_loop(); });
  return true;
}

bool PluginHostClient::write_line(const std::string& line, std::string& error) {
  std::lock_guard lock(write_mutex_);
  if (!running_ || stdin_fd_ < 0) {
    error = "plugin host is not running";
    return false;
  }
  const std::string payload = line + "\n";
  size_t offset = 0;
  while (offset < payload.size()) {
    const ssize_t written = write(stdin_fd_, payload.data() + offset, payload.size() - offset);
    if (written <= 0) {
      if (errno == EINTR) continue;
      error = "cannot write to plugin host: " + std::string(std::strerror(errno));
      running_ = false;
      return false;
    }
    offset += static_cast<size_t>(written);
  }
  return true;
}

bool PluginHostClient::read_line(std::string& line, std::string& error) {
  for (;;) {
    const auto newline = read_buffer_.find('\n');
    if (newline != std::string::npos) {
      line = read_buffer_.substr(0, newline);
      read_buffer_.erase(0, newline + 1);
      return true;
    }
    char buffer[4096];
    const ssize_t read_size = read(stdout_fd_, buffer, sizeof(buffer));
    if (read_size == 0) {
      error = "plugin host exited unexpectedly";
      running_ = false;
      return false;
    }
    if (read_size < 0) {
      if (errno == EINTR) continue;
      error = "cannot read from plugin host: " + std::string(std::strerror(errno));
      running_ = false;
      return false;
    }
    read_buffer_.append(buffer, static_cast<size_t>(read_size));
  }
}

bool PluginHostClient::alive() {
  if (!running_) return false;
  if (pid_ <= 0) return false;
  int status = 0;
  const pid_t result = waitpid(pid_, &status, WNOHANG);
  if (result == 0) return true;
  running_ = false;
  pid_ = -1;
  return false;
}

void PluginHostClient::close_stdin() {
  std::lock_guard lock(write_mutex_);
  if (stdin_fd_ >= 0) {
    close(stdin_fd_);
    stdin_fd_ = -1;
  }
}

void PluginHostClient::stop() {
  std::lock_guard lifecycle_lock(lifecycle_mutex_);
  if (running_) {
    std::string ignored;
    send_without_reply({{"op", "shutdown"}}, ignored);
  }
  running_ = false;
  close_stdin();
  if (pid_ > 0) {
    for (int attempt = 0; attempt < 20; ++attempt) {
      int status = 0;
      if (waitpid(pid_, &status, WNOHANG) == pid_) {
        pid_ = -1;
        break;
      }
      usleep(25 * 1000);
    }
    if (pid_ > 0) {
      kill(pid_, SIGKILL);
      int status = 0;
      waitpid(pid_, &status, 0);
      pid_ = -1;
    }
  }
  if (reader_.joinable()) reader_.join();
  if (stdout_fd_ >= 0) {
    close(stdout_fd_);
    stdout_fd_ = -1;
  }
  read_buffer_.clear();
  fail_all_pending("plugin host stopped");
}

#endif

bool PluginHostClient::request(const nlohmann::json& operation, nlohmann::json& response, std::string& error) {
  if (!running_) {
    error = "plugin host is not running";
    return false;
  }
  const uint64_t id = next_id_.fetch_add(1, std::memory_order_relaxed);
  nlohmann::json message = operation;
  message["id"] = id;
  {
    std::lock_guard lock(pending_mutex_);
    if (!running_) {
      error = "plugin host is not running";
      return false;
    }
    pending_[id] = PendingResponse{};
  }
  if (!write_line(message.dump(), error)) {
    std::lock_guard lock(pending_mutex_);
    pending_.erase(id);
    return false;
  }

  std::unique_lock lock(pending_mutex_);
  pending_cv_.wait(lock, [&] { return pending_[id].done || !running_; });
  const auto iterator = pending_.find(id);
  if (iterator == pending_.end()) {
    error = "plugin host request state was lost";
    return false;
  }
  const auto result = iterator->second;
  pending_.erase(iterator);
  if (!result.done) {
    error = result.error.empty() ? "plugin host stopped before replying" : result.error;
    return false;
  }
  response = result.response;
  if (!result.ok) {
    error = result.error.empty() ? "plugin host request failed" : result.error;
    return false;
  }
  return true;
}

bool PluginHostClient::cancel_sse(const std::string& stream_id, const std::string& reason, std::string& error) {
  if (stream_id.empty()) {
    error = "SSE stream id is empty";
    return false;
  }
  return send_without_reply({{"op", "sse.cancel"}, {"streamId", stream_id}, {"reason", reason}}, error);
}

bool PluginHostClient::send_without_reply(const nlohmann::json& operation, std::string& error) {
  if (!running_) {
    error = "plugin host is not running";
    return false;
  }
  const uint64_t id = next_id_.fetch_add(1, std::memory_order_relaxed);
  nlohmann::json message = operation;
  message["id"] = id;
  {
    std::lock_guard lock(pending_mutex_);
    if (!running_) {
      error = "plugin host is not running";
      return false;
    }
    ignored_responses_.insert(id);
  }
  if (!write_line(message.dump(), error)) {
    std::lock_guard lock(pending_mutex_);
    ignored_responses_.erase(id);
    return false;
  }
  return true;
}

void PluginHostClient::reader_loop() {
  std::string terminal_error;
  for (;;) {
    std::string line;
    if (!read_line(line, terminal_error)) break;
    nlohmann::json parsed;
    try {
      parsed = nlohmann::json::parse(line);
    } catch (const nlohmann::json::exception& exception) {
      terminal_error = protocol_error(exception.what());
      running_ = false;
      break;
    }
    if (!parsed.is_object()) {
      terminal_error = protocol_error("message is not an object");
      running_ = false;
      break;
    }
    if (parsed.contains("event")) {
      if (event_handler_) {
        try {
          event_handler_(parsed);
        } catch (...) {
          // 插件事件消费者异常不能破坏宿主读取线程。
        }
      }
      continue;
    }
    if (!parsed.contains("id") || !parsed["id"].is_number_unsigned()) {
      terminal_error = protocol_error("response id is missing");
      running_ = false;
      break;
    }
    const auto id = parsed["id"].get<uint64_t>();
    {
      std::lock_guard lock(pending_mutex_);
      if (ignored_responses_.erase(id) > 0) continue;
      const auto iterator = pending_.find(id);
      if (iterator == pending_.end()) {
        terminal_error = protocol_error("response id does not match the request");
        running_ = false;
        break;
      }
      iterator->second.done = true;
      iterator->second.ok = parsed.value("ok", false);
      iterator->second.response = parsed;
      iterator->second.error = parsed.value("error", std::string());
    }
    pending_cv_.notify_all();
  }
  running_ = false;
  fail_all_pending(terminal_error.empty() ? "plugin host stopped" : terminal_error);
  pending_cv_.notify_all();
}

void PluginHostClient::finish_pending(uint64_t id, bool ok, nlohmann::json response, std::string error) {
  {
    std::lock_guard lock(pending_mutex_);
    auto iterator = pending_.find(id);
    if (iterator == pending_.end()) return;
    iterator->second.done = true;
    iterator->second.ok = ok;
    iterator->second.response = std::move(response);
    iterator->second.error = std::move(error);
  }
  pending_cv_.notify_all();
}

void PluginHostClient::fail_all_pending(const std::string& error) {
  {
    std::lock_guard lock(pending_mutex_);
    for (auto& [id, pending] : pending_) {
      (void)id;
      if (pending.done) continue;
      pending.done = true;
      pending.ok = false;
      pending.error = error;
    }
    ignored_responses_.clear();
  }
  pending_cv_.notify_all();
}

}  // namespace plugmesh
