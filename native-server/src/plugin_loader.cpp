#include "plugmesh/plugin_loader.h"

#ifdef _WIN32
#include <windows.h>
#else
#include <dlfcn.h>
#endif

namespace plugmesh {

PluginLoader::~PluginLoader() { unload(); }

bool PluginLoader::load(const std::filesystem::path& library_path, std::string& error) {
  unload();
#ifdef _WIN32
  handle_ = static_cast<void*>(LoadLibraryW(library_path.wstring().c_str()));
  if (!handle_) {
    error = "LoadLibraryW failed";
    return false;
  }
  auto entry = reinterpret_cast<plugmesh_plugin_get_api_fn>(reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(handle_), "plugmesh_plugin_get_api")));
#else
  handle_ = dlopen(library_path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!handle_) {
    const auto* detail = dlerror();
    error = detail ? detail : "dlopen failed";
    return false;
  }
  auto entry = reinterpret_cast<plugmesh_plugin_get_api_fn>(dlsym(handle_, "plugmesh_plugin_get_api"));
#endif
  if (!entry) {
    error = "plugmesh_plugin_get_api was not exported";
    unload();
    return false;
  }
  api_ = entry();
  if (!api_ || api_->abi_version != PLUGMESH_PLUGIN_ABI_VERSION || !api_->plugin_id || !api_->plugin_name || !api_->plugin_version || !api_->start || !api_->stop || !api_->health) {
    error = "plugin ABI version or required entry points are invalid";
    unload();
    return false;
  }
  return true;
}

void PluginLoader::unload() {
  api_ = nullptr;
  if (!handle_) return;
#ifdef _WIN32
  FreeLibrary(static_cast<HMODULE>(handle_));
#else
  dlclose(handle_);
#endif
  handle_ = nullptr;
}

}  // namespace plugmesh
