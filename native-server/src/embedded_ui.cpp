#if defined(_WIN32)
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#endif
#ifndef WINVER
#define WINVER 0x0600
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#endif

#include "plugmesh/embedded_ui.h"
#include "embedded_ui_internal.h"

#include <algorithm>
#include <array>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <limits>
#include <random>
#include <string>
#include <string_view>
#include <system_error>

#if defined(_WIN32)
#include <windows.h>
#include <winternl.h>
#else
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

namespace plugmesh {
namespace {

struct EmbeddedUiAsset {
  std::string_view path;
  std::string_view content;
};

#include "embedded_ui_assets.inc"

bool fail(std::string& error, const std::string& message, const std::error_code& code = {}) {
  error = code ? message + ": " + code.message() : message;
  return false;
}

std::string random_token() {
  static constexpr char hex[] = "0123456789abcdef";
  std::random_device random;
  std::array<unsigned int, 4> values{};
  for (auto& value : values) value = random();

  std::string token;
  token.reserve(values.size() * 8);
  for (const auto value : values) {
    for (int shift = 28; shift >= 0; shift -= 4) token.push_back(hex[(value >> shift) & 0xf]);
  }
  return token;
}

bool is_safe_relative_path(const std::filesystem::path& path) {
  if (path.empty() || path.is_absolute() || path.has_root_name() || path.has_root_directory()) return false;
  for (const auto& component : path) {
    if (component.empty() || component == "." || component == "..") return false;
  }
  return true;
}

bool create_staging_directory(const std::filesystem::path& parent,
                              const std::string& base_name,
                              std::filesystem::path& staging,
                              std::string& error) {
  for (int attempt = 0; attempt < 16; ++attempt) {
    const auto candidate = parent / (base_name + ".plugmesh-new-" + random_token());
    std::error_code code;
    if (!std::filesystem::create_directory(candidate, code)) {
      if (!code || code == std::errc::file_exists) continue;
      return fail(error, "Unable to create Native UI staging directory", code);
    }
#if !defined(_WIN32)
    if (::chmod(candidate.c_str(), S_IRWXU) != 0) {
      const std::error_code permission_error(errno, std::generic_category());
      std::error_code ignored;
      std::filesystem::remove(candidate, ignored);
      return fail(error, "Unable to restrict Native UI staging directory permissions", permission_error);
    }
#endif
    staging = candidate;
    return true;
  }
  return fail(error, "Unable to allocate a unique Native UI staging directory");
}

}  // namespace

namespace detail {

#if defined(_WIN32)
class ScopedHandle {
 public:
  explicit ScopedHandle(HANDLE handle = INVALID_HANDLE_VALUE) : handle_(handle) {}
  ~ScopedHandle() { if (valid()) CloseHandle(handle_); }
  ScopedHandle(const ScopedHandle&) = delete;
  ScopedHandle& operator=(const ScopedHandle&) = delete;
  bool valid() const { return handle_ != nullptr && handle_ != INVALID_HANDLE_VALUE; }
  HANDLE get() const { return handle_; }
  HANDLE release() {
    const HANDLE handle = handle_;
    handle_ = INVALID_HANDLE_VALUE;
    return handle;
  }
  void reset(HANDLE handle) {
    if (valid()) CloseHandle(handle_);
    handle_ = handle;
  }

 private:
  HANDLE handle_;
};

using NtCreateFileFunction = NTSTATUS (NTAPI *)(PHANDLE, ACCESS_MASK, POBJECT_ATTRIBUTES, PIO_STATUS_BLOCK,
                                                  PLARGE_INTEGER, ULONG, ULONG, ULONG, ULONG, PVOID, ULONG);
using NtStatusToDosErrorFunction = ULONG (NTAPI *)(NTSTATUS);

template <typename Function>
Function resolve_nt_function(const char* name) {
  const HMODULE ntdll = GetModuleHandleW(L"ntdll.dll");
  const FARPROC address = ntdll ? GetProcAddress(ntdll, name) : nullptr;
  static_assert(sizeof(Function) == sizeof(address));
  Function function = nullptr;
  std::memcpy(&function, &address, sizeof(function));
  return function;
}

DWORD nt_status_to_windows_error(NTSTATUS status) {
  const auto convert = resolve_nt_function<NtStatusToDosErrorFunction>("RtlNtStatusToDosError");
  return convert ? static_cast<DWORD>(convert(status)) : ERROR_GEN_FAILURE;
}

bool open_relative_no_follow(HANDLE parent,
                             const std::wstring& component,
                             ACCESS_MASK access,
                             ULONG attributes,
                             ULONG share_mode,
                             ULONG disposition,
                             ULONG options,
                             HANDLE& result,
                             std::string& error,
                             const std::string& failure_message) {
  if (component.empty() || component.size() > (std::numeric_limits<USHORT>::max() - sizeof(wchar_t)) / sizeof(wchar_t)) {
    return fail(error, failure_message, {ERROR_FILENAME_EXCED_RANGE, std::system_category()});
  }
  const auto create_file = resolve_nt_function<NtCreateFileFunction>("NtCreateFile");
  if (!create_file) return fail(error, failure_message, {ERROR_PROC_NOT_FOUND, std::system_category()});

  UNICODE_STRING name{};
  name.Buffer = const_cast<PWSTR>(component.c_str());
  name.Length = static_cast<USHORT>(component.size() * sizeof(wchar_t));
  name.MaximumLength = static_cast<USHORT>(name.Length + sizeof(wchar_t));
  OBJECT_ATTRIBUTES object_attributes{};
  object_attributes.Length = sizeof(object_attributes);
  object_attributes.RootDirectory = parent;
  object_attributes.ObjectName = &name;
  object_attributes.Attributes = OBJ_CASE_INSENSITIVE;
  IO_STATUS_BLOCK io_status{};
  HANDLE handle = INVALID_HANDLE_VALUE;
  const NTSTATUS status = create_file(&handle, access, &object_attributes, &io_status, nullptr, attributes,
                                     share_mode, disposition, options, nullptr, 0);
  if (status < 0) {
    return fail(error, failure_message, {static_cast<int>(nt_status_to_windows_error(status)), std::system_category()});
  }
  result = handle;
  return true;
}

bool write_asset_no_follow(const std::filesystem::path& root,
                           const std::filesystem::path& relative,
                           std::string_view content,
                           std::string& error) {
  constexpr ACCESS_MASK directory_access = FILE_LIST_DIRECTORY | FILE_ADD_FILE | FILE_ADD_SUBDIRECTORY |
                                           FILE_READ_ATTRIBUTES | SYNCHRONIZE;
  constexpr ULONG directory_options = FILE_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT;
  ScopedHandle directory(CreateFileW(root.c_str(), directory_access,
                                     FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING,
                                     FILE_FLAG_BACKUP_SEMANTICS | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
  if (!directory.valid()) {
    return fail(error, "Unable to open Native UI staging directory", {static_cast<int>(GetLastError()), std::system_category()});
  }
  FILE_ATTRIBUTE_TAG_INFO root_info{};
  if (!GetFileInformationByHandleEx(directory.get(), FileAttributeTagInfo, &root_info, sizeof(root_info)) ||
      (root_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
      (root_info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
    return fail(error, "Native UI staging root is a reparse point or non-directory", {ERROR_ACCESS_DENIED, std::system_category()});
  }

  auto component = relative.begin();
  for (; component != relative.end(); ++component) {
    const std::wstring name = component->native();
    auto next = component;
    ++next;
    if (next != relative.end()) {
      HANDLE child_handle = INVALID_HANDLE_VALUE;
      if (!open_relative_no_follow(directory.get(), name, directory_access, FILE_ATTRIBUTE_DIRECTORY,
                                   FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, FILE_OPEN_IF,
                                   directory_options, child_handle, error,
                                   "Unable to open Native UI asset directory: " + relative.generic_string())) {
        return false;
      }
      ScopedHandle child(child_handle);
      FILE_ATTRIBUTE_TAG_INFO child_info{};
      if (!GetFileInformationByHandleEx(child.get(), FileAttributeTagInfo, &child_info, sizeof(child_info)) ||
          (child_info.FileAttributes & FILE_ATTRIBUTE_REPARSE_POINT) != 0 ||
          (child_info.FileAttributes & FILE_ATTRIBUTE_DIRECTORY) == 0) {
        return fail(error, "Native UI staging path contains a reparse point or non-directory: " + relative.generic_string(),
                    {ERROR_ACCESS_DENIED, std::system_category()});
      }
      directory.reset(child.release());
      continue;
    }

    HANDLE file_handle = INVALID_HANDLE_VALUE;
    if (!open_relative_no_follow(directory.get(), name, GENERIC_WRITE | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
                                 FILE_ATTRIBUTE_NORMAL, 0, FILE_CREATE,
                                 FILE_NON_DIRECTORY_FILE | FILE_OPEN_REPARSE_POINT | FILE_SYNCHRONOUS_IO_NONALERT,
                                 file_handle, error,
                                 "Unable to create embedded Native UI asset: " + relative.generic_string())) {
      return false;
    }
    ScopedHandle file(file_handle);
    std::size_t offset = 0;
    while (offset < content.size()) {
      const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(content.size() - offset, MAXDWORD));
      DWORD written = 0;
      if (!WriteFile(file.get(), content.data() + offset, chunk, &written, nullptr)) {
        return fail(error, "Unable to write embedded Native UI asset: " + relative.generic_string(),
                    {static_cast<int>(GetLastError()), std::system_category()});
      }
      if (written == 0) {
        return fail(error, "Unable to write embedded Native UI asset: " + relative.generic_string(),
                    {ERROR_WRITE_FAULT, std::system_category()});
      }
      offset += written;
    }
  }
  return true;
}
#else
class ScopedFd {
 public:
  explicit ScopedFd(int fd = -1) : fd_(fd) {}
  ~ScopedFd() { if (fd_ >= 0) ::close(fd_); }
  ScopedFd(const ScopedFd&) = delete;
  ScopedFd& operator=(const ScopedFd&) = delete;
  int get() const { return fd_; }
  void reset(int fd) {
    if (fd_ >= 0) ::close(fd_);
    fd_ = fd;
  }

 private:
  int fd_;
};

bool write_asset_no_follow(const std::filesystem::path& root,
                           const std::filesystem::path& relative,
                           std::string_view content,
                           std::string& error) {
  ScopedFd directory(::open(root.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW));
  if (directory.get() < 0) {
    return fail(error, "Unable to open Native UI staging directory", {errno, std::generic_category()});
  }

  auto component = relative.begin();
  for (; component != relative.end(); ++component) {
    const std::string name = component->string();
    auto next = component;
    ++next;
    if (next != relative.end()) {
      if (::mkdirat(directory.get(), name.c_str(), S_IRWXU) != 0 && errno != EEXIST) {
        return fail(error, "Unable to create Native UI asset directory: " + relative.generic_string(),
                    {errno, std::generic_category()});
      }
      const int child = ::openat(directory.get(), name.c_str(), O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW);
      if (child < 0) {
        return fail(error, "Native UI staging path contains a symlink or non-directory: " + relative.generic_string(),
                    {errno, std::generic_category()});
      }
      directory.reset(child);
      continue;
    }

    ScopedFd file(::openat(directory.get(), name.c_str(), O_WRONLY | O_CREAT | O_EXCL | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK, S_IRUSR | S_IWUSR));
    if (file.get() < 0) {
      return fail(error, "Unable to create embedded Native UI asset: " + relative.generic_string(),
                  {errno, std::generic_category()});
    }
    struct stat status {};
    if (::fstat(file.get(), &status) != 0) {
      return fail(error, "Unable to inspect embedded Native UI asset: " + relative.generic_string(),
                  {errno, std::generic_category()});
    }
    if (!S_ISREG(status.st_mode)) {
      return fail(error, "Embedded Native UI asset is not a regular file: " + relative.generic_string(),
                  {EINVAL, std::generic_category()});
    }
    std::size_t offset = 0;
    while (offset < content.size()) {
      const auto chunk = std::min<std::size_t>(content.size() - offset, 64 * 1024);
      const auto written = ::write(file.get(), content.data() + offset, chunk);
      if (written < 0 && errno == EINTR) continue;
      if (written <= 0) {
        return fail(error, "Unable to write embedded Native UI asset: " + relative.generic_string(),
                    {errno == 0 ? EIO : errno, std::generic_category()});
      }
      offset += static_cast<std::size_t>(written);
    }
  }
  return true;
}
#endif

}  // namespace detail

namespace {

void remove_ignoring_errors(const std::filesystem::path& path) {
  std::error_code ignored;
  std::filesystem::remove_all(path, ignored);
}

}  // namespace

bool extract_embedded_ui(const std::filesystem::path& target_directory, std::string& error) {
  if (embedded_ui_assets.empty()) return fail(error, "Native UI assets are not embedded in this build");
  if (target_directory.empty() || target_directory.filename().empty() ||
      target_directory.filename() == "." || target_directory.filename() == "..") {
    return fail(error, "Native UI output directory is empty or invalid");
  }

  std::error_code code;
  auto parent = target_directory.parent_path();
  if (parent.empty()) {
    parent = std::filesystem::current_path(code);
    if (code) return fail(error, "Unable to resolve Native UI parent directory", code);
  }
  std::filesystem::create_directories(parent, code);
  if (code) return fail(error, "Unable to create Native UI parent directory", code);

  const std::string base_name = target_directory.filename().string();
  std::filesystem::path temporary;
  if (!create_staging_directory(parent, base_name, temporary, error)) return false;

  for (const auto& asset : embedded_ui_assets) {
    const std::filesystem::path relative(asset.path);
    if (!is_safe_relative_path(relative)) {
      remove_ignoring_errors(temporary);
      return fail(error, "Embedded Native UI contains an unsafe path");
    }
    if (!detail::write_asset_no_follow(temporary, relative, asset.content, error)) {
      remove_ignoring_errors(temporary);
      return false;
    }
  }

  const auto target = target_directory.is_absolute() ? target_directory : parent / target_directory.filename();
  const auto previous = parent / (base_name + ".plugmesh-old-" + random_token());
  auto target_status = std::filesystem::symlink_status(target, code);
  if (code == std::errc::no_such_file_or_directory) {
    code.clear();
    target_status = std::filesystem::file_status(std::filesystem::file_type::not_found);
  }
  if (code) {
    remove_ignoring_errors(temporary);
    return fail(error, "Unable to inspect Native UI output directory", code);
  }
  const bool had_previous = target_status.type() != std::filesystem::file_type::not_found;
  if (had_previous) {
    std::filesystem::rename(target, previous, code);
    if (code) {
      remove_ignoring_errors(temporary);
      return fail(error, "Unable to replace existing Native UI directory", code);
    }
  }

  std::filesystem::rename(temporary, target, code);
  if (code) {
    const auto install_error = code;
    if (had_previous) {
      std::error_code restore_error;
      std::filesystem::rename(previous, target, restore_error);
      if (restore_error) {
        remove_ignoring_errors(temporary);
        return fail(error, "Unable to install embedded Native UI or restore previous directory: " + restore_error.message(), install_error);
      }
    }
    remove_ignoring_errors(temporary);
    return fail(error, "Unable to install embedded Native UI", install_error);
  }

  if (had_previous) remove_ignoring_errors(previous);
  error.clear();
  return true;
}

}  // namespace plugmesh
