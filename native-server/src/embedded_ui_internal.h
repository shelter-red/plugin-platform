#pragma once

#include <filesystem>
#include <string>
#include <string_view>

namespace plugmesh::detail {

bool write_asset_no_follow(const std::filesystem::path& root,
                           const std::filesystem::path& relative,
                           std::string_view content,
                           std::string& error);

}  // namespace plugmesh::detail
