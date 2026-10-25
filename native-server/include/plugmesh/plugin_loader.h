#pragma once

#include "plugmesh/plugin_api.h"

#include <filesystem>
#include <memory>
#include <string>

namespace plugmesh {

class PluginLoader {
 public:
  PluginLoader() = default;
  PluginLoader(const PluginLoader&) = delete;
  PluginLoader& operator=(const PluginLoader&) = delete;
  ~PluginLoader();

  bool load(const std::filesystem::path& library_path, std::string& error);
  void unload();
  const plugmesh_plugin_api* api() const { return api_; }
  uint32_t abi_version() const { return api_ ? api_->abi_version : 0; }
  bool loaded() const { return handle_ != nullptr && api_ != nullptr; }

 private:
  void* handle_ = nullptr;
  const plugmesh_plugin_api* api_ = nullptr;
};

}  // namespace plugmesh
