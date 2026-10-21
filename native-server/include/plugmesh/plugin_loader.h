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
  const plugmesh_plugin_api_v2* api() const { return api_; }
  const plugmesh_plugin_api_v3* api_v3() const { return api_v3_; }
  const plugmesh_plugin_api_v4* api_v4() const { return api_v4_; }
  uint32_t abi_version() const {
    if (api_v4_) return PLUGMESH_PLUGIN_ABI_VERSION_V4;
    if (api_v3_) return PLUGMESH_PLUGIN_ABI_VERSION_V3;
    return PLUGMESH_PLUGIN_ABI_VERSION;
  }
  bool loaded() const { return handle_ != nullptr && api_ != nullptr; }

 private:
  void* handle_ = nullptr;
  const plugmesh_plugin_api_v2* api_ = nullptr;
  const plugmesh_plugin_api_v3* api_v3_ = nullptr;
  const plugmesh_plugin_api_v4* api_v4_ = nullptr;
};

}  // namespace plugmesh
