#pragma once

#include <filesystem>
#include <string>

namespace plugmesh {

bool extract_embedded_ui(const std::filesystem::path& target_directory, std::string& error);

}
