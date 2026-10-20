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
  auto entry = reinterpret_cast<plugmesh_plugin_get_api_v1_fn>(GetProcAddress(static_cast<HMODULE>(handle_), "plugmesh_plugin_get_api_v1"));
#else
  handle_ = dlopen(library_path.c_str(), RTLD_NOW | RTLD_LOCAL);
  if (!handle_) {
    error = dlerror() ? dlerror() : "dlopen failed";
    return false;
  }
  auto entry = reinterpret_cast<plugmesh_plugin_get_api_v1_fn>(dlsym(handle_, "plugmesh_plugin_get_api_v1"));
#endif
  if (!entry) {
    error = "plugmesh_plugin_get_api_v1 was not exported";
    unload();
    return false;
  }
  api_ = entry();
  if (!api_ || api_->abi_version != PLUGMESH_PLUGIN_ABI_VERSION || !api_->start || !api_->stop || !api_->health || !api_->handle_http) {
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
