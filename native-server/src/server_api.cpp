#include "plugmesh/server_api.h"

#include "plugmesh/control_client.h"
#include "plugmesh/plugin_manager.h"
#include "plugmesh/server_config.h"

#include <cstring>
#include <memory>
#include <mutex>
#include <new>
#include <exception>
#include <string>
#include <thread>

namespace {

void copy_error(char* buffer, const size_t capacity, const std::string& message) {
  if (!buffer || capacity == 0) return;
  const auto length = capacity - 1 < message.size() ? capacity - 1 : message.size();
  std::memcpy(buffer, message.data(), length);
  buffer[length] = '\0';
}

std::string value_or_empty(const char* value) {
  return value ? std::string(value) : std::string();
}

}  // namespace

struct plugmesh_server {
  mutable std::mutex mutex;
  plugmesh::ServerConfig config;
  std::string plugin_host_executable;
  std::unique_ptr<plugmesh::PluginManager> plugins;
  std::unique_ptr<plugmesh::ControlClient> client;
  std::thread worker;
  std::string last_error;
  bool running = false;
  bool stopping = false;
};

namespace {

void run_client(plugmesh_server* server) {
  std::string error;
  const auto connected = server->client->run(error);
  std::lock_guard lock(server->mutex);
  server->running = false;
  if (!connected && !server->stopping) server->last_error = error.empty() ? "control connection stopped unexpectedly" : error;
}

void join_finished_worker(plugmesh_server* server) {
  std::thread finished;
  {
    std::lock_guard lock(server->mutex);
    if (server->running || !server->worker.joinable()) return;
    finished = std::move(server->worker);
  }
  if (finished.joinable()) finished.join();
}

}  // namespace

extern "C" {

plugmesh_server* plugmesh_server_create(const plugmesh_server_config* input, char* error_buffer, size_t error_capacity) {
  if (!input) {
    copy_error(error_buffer, error_capacity, "server configuration is required");
    return nullptr;
  }

  auto server = std::unique_ptr<plugmesh_server>(new (std::nothrow) plugmesh_server());
  if (!server) {
    copy_error(error_buffer, error_capacity, "unable to allocate server");
    return nullptr;
  }
  try {
    server->config.worker_url = value_or_empty(input->worker_url);
    server->config.server_id = value_or_empty(input->server_id);
    server->config.access_token = value_or_empty(input->access_token);
    server->config.plugin_directory = value_or_empty(input->plugin_directory);
    server->plugin_host_executable = value_or_empty(input->plugin_host_executable);

    std::string error;
    if (!plugmesh::validate_config(server->config, error)) {
      copy_error(error_buffer, error_capacity, error);
      return nullptr;
    }
  } catch (const std::exception& exception) {
    copy_error(error_buffer, error_capacity, exception.what());
    return nullptr;
  }
  copy_error(error_buffer, error_capacity, {});
  return server.release();
}

int plugmesh_server_start(plugmesh_server* server) {
  if (!server) return 0;
  join_finished_worker(server);

  try {
    std::lock_guard lock(server->mutex);
    if (server->running) {
      server->last_error = "server is already running";
      return 0;
    }
    if (!server->plugins) server->plugins = std::make_unique<plugmesh::PluginManager>();
    if (!server->plugin_host_executable.empty()) server->plugins->set_host_executable(server->plugin_host_executable);

    std::string error;
    if (!server->plugins->discover(server->config.plugin_directory, error)) {
      server->last_error = error;
      return 0;
    }
    server->client = std::make_unique<plugmesh::ControlClient>(server->config, *server->plugins);
    server->last_error.clear();
    server->stopping = false;
    server->running = true;
    server->worker = std::thread(run_client, server);
  } catch (const std::exception& exception) {
    std::lock_guard lock(server->mutex);
    server->running = false;
    server->client.reset();
    server->last_error = exception.what();
    return 0;
  }
  return 1;
}

void plugmesh_server_stop(plugmesh_server* server) {
  if (!server) return;
  plugmesh::ControlClient* client = nullptr;
  {
    std::lock_guard lock(server->mutex);
    server->stopping = true;
    client = server->client.get();
  }
  if (client) client->stop();

  std::thread worker;
  {
    std::lock_guard lock(server->mutex);
    worker = std::move(server->worker);
  }
  if (worker.joinable()) worker.join();

  std::lock_guard lock(server->mutex);
  server->running = false;
  server->client.reset();
  server->plugins.reset();
  server->stopping = false;
}

void plugmesh_server_destroy(plugmesh_server* server) {
  if (!server) return;
  plugmesh_server_stop(server);
  delete server;
}

int plugmesh_server_is_running(const plugmesh_server* server) {
  if (!server) return 0;
  std::lock_guard lock(server->mutex);
  return server->running ? 1 : 0;
}

const char* plugmesh_server_last_error(const plugmesh_server* server) {
  if (!server) return "server is null";
  std::lock_guard lock(server->mutex);
  return server->last_error.c_str();
}

}  // extern "C"
