cmake_minimum_required(VERSION 3.16)
project(plugmesh_server LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

add_library(plugmesh_core STATIC
  src/plugin_loader.cpp
  src/plugin_manager.cpp
  src/server_config.cpp
)
target_include_directories(plugmesh_core PUBLIC include)

add_executable(plugmesh-server src/main.cpp)
target_link_libraries(plugmesh-server PRIVATE plugmesh_core)

add_library(plugmesh-sample SHARED examples/sample_plugin.cpp)
target_include_directories(plugmesh-sample PRIVATE include)

add_executable(plugmesh-plugin-loader-smoke tests/plugin_loader_smoke.cpp)
target_link_libraries(plugmesh-plugin-loader-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-manager-smoke tests/plugin_manager_smoke.cpp)
target_link_libraries(plugmesh-plugin-manager-smoke PRIVATE plugmesh_core)

if (WIN32)
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_WINDOWS=1)
else()
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_POSIX=1)
  target_link_libraries(plugmesh_core PRIVATE ${CMAKE_DL_LIBS})
endif()
