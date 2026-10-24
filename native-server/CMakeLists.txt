cmake_minimum_required(VERSION 3.16)
project(plugmesh_server LANGUAGES CXX)

enable_testing()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(PLUGMESH_BUILD_ARTIFACT "ALL" CACHE STRING "Build artifact: ALL, EXECUTABLE or SHARED")
set_property(CACHE PLUGMESH_BUILD_ARTIFACT PROPERTY STRINGS ALL EXECUTABLE SHARED)
if (NOT PLUGMESH_BUILD_ARTIFACT STREQUAL "ALL" AND NOT PLUGMESH_BUILD_ARTIFACT STREQUAL "EXECUTABLE" AND NOT PLUGMESH_BUILD_ARTIFACT STREQUAL "SHARED")
  message(FATAL_ERROR "PLUGMESH_BUILD_ARTIFACT must be ALL, EXECUTABLE or SHARED")
endif()

if (NOT MSVC)
  # 自家源码保持 0 警告；第三方头文件不产生警告，已用 -Wall -Wextra 全量构建确认。
  add_compile_options(-Wall -Wextra)
endif()

if (MINGW)
  # 静态链接 MinGW 运行时，产物只依赖系统 DLL，部署时无需附带 libstdc++/libgcc/libwinpthread。
  add_link_options(-static)
endif()

find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

add_library(plugmesh_core STATIC
  src/control_client.cpp
  src/control_protocol.cpp
  src/credential_store.cpp
  src/local_http_server.cpp
  src/plugin_host_client.cpp
  src/plugin_host_protocol.cpp
  src/plugin_loader.cpp
  src/plugin_manager.cpp
  src/registration_client.cpp
  src/server_config.cpp
)
set_target_properties(plugmesh_core PROPERTIES POSITION_INDEPENDENT_CODE ON)
target_compile_definitions(plugmesh_core PUBLIC ASIO_STANDALONE)
# 内置 websocketpp 只用 __cplusplus 判断 C++11 能力，而 MSVC 默认把 __cplusplus
# 报成 199711L，于是 random/type_traits 退回 boost 分支（仓库不随附 Boost），
# Windows 构建直接报 C1083。项目固定 C++20，这里显式声明完整 C++11 STL 支持。
target_compile_definitions(plugmesh_core PUBLIC _WEBSOCKETPP_CPP11_STL_)
target_include_directories(plugmesh_core PUBLIC include)
target_include_directories(plugmesh_core SYSTEM PUBLIC third_party/include)
target_link_libraries(plugmesh_core PUBLIC OpenSSL::SSL OpenSSL::Crypto Threads::Threads)

if (PLUGMESH_BUILD_ARTIFACT STREQUAL "ALL" OR PLUGMESH_BUILD_ARTIFACT STREQUAL "EXECUTABLE")
  add_executable(plugmesh-server src/main.cpp)
  target_link_libraries(plugmesh-server PRIVATE plugmesh_core)
endif()

if (PLUGMESH_BUILD_ARTIFACT STREQUAL "ALL" OR PLUGMESH_BUILD_ARTIFACT STREQUAL "SHARED")
  add_library(plugmesh-server-shared SHARED src/server_api.cpp)
  set_target_properties(plugmesh-server-shared PROPERTIES OUTPUT_NAME plugmesh-server)
  target_include_directories(plugmesh-server-shared PUBLIC include)
  target_link_libraries(plugmesh-server-shared PRIVATE plugmesh_core)
endif()

add_library(plugmesh-sample SHARED examples/sample_plugin.cpp)
target_include_directories(plugmesh-sample PRIVATE include)

add_library(plugmesh-lifecycle-sample SHARED examples/lifecycle_plugin.cpp)
target_include_directories(plugmesh-lifecycle-sample PRIVATE include)

add_library(plugmesh-crashing-sample SHARED examples/crashing_plugin.cpp)
target_include_directories(plugmesh-crashing-sample PRIVATE include)

add_library(plugmesh-cancellable-sample SHARED examples/cancellable_plugin.cpp)
target_include_directories(plugmesh-cancellable-sample PRIVATE include)

file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/plugins/sample.plugin/manifest.json" CONTENT "{\n  \"id\": \"sample.plugin\",\n  \"name\": \"Sample Plugin\",\n  \"version\": \"0.1.0\",\n  \"abiVersion\": \"2\",\n  \"library\": \"$<TARGET_FILE_NAME:plugmesh-sample>\",\n  \"capabilities\": {\"http\": true, \"websocket\": true, \"sse\": true, \"fileStream\": true},\n  \"permissions\": [],\n  \"healthPath\": \"/health\"\n}\n")
add_custom_command(TARGET plugmesh-sample POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/plugins/sample.plugin"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:plugmesh-sample>" "${CMAKE_CURRENT_BINARY_DIR}/plugins/sample.plugin/$<TARGET_FILE_NAME:plugmesh-sample>"
)

file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/plugins/lifecycle.plugin/manifest.json" CONTENT "{\n  \"id\": \"lifecycle.plugin\",\n  \"name\": \"Lifecycle Plugin\",\n  \"version\": \"0.1.0\",\n  \"abiVersion\": \"3\",\n  \"library\": \"$<TARGET_FILE_NAME:plugmesh-lifecycle-sample>\",\n  \"capabilities\": {\"http\": true, \"websocket\": true, \"sse\": false, \"fileStream\": false},\n  \"permissions\": [],\n  \"healthPath\": \"/health\"\n}\n")
add_custom_command(TARGET plugmesh-lifecycle-sample POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/plugins/lifecycle.plugin"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:plugmesh-lifecycle-sample>" "${CMAKE_CURRENT_BINARY_DIR}/plugins/lifecycle.plugin/$<TARGET_FILE_NAME:plugmesh-lifecycle-sample>"
)

file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/plugins/crashing.plugin/manifest.json" CONTENT "{\n  \"id\": \"crashing.plugin\",\n  \"name\": \"Crashing Plugin\",\n  \"version\": \"0.1.0\",\n  \"abiVersion\": \"2\",\n  \"library\": \"$<TARGET_FILE_NAME:plugmesh-crashing-sample>\",\n  \"capabilities\": {\"http\": true, \"websocket\": false, \"sse\": false, \"fileStream\": false},\n  \"permissions\": [],\n  \"healthPath\": \"/health\"\n}\n")
add_custom_command(TARGET plugmesh-crashing-sample POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/plugins/crashing.plugin"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:plugmesh-crashing-sample>" "${CMAKE_CURRENT_BINARY_DIR}/plugins/crashing.plugin/$<TARGET_FILE_NAME:plugmesh-crashing-sample>"
)
file(GENERATE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/plugins/cancellable.plugin/manifest.json" CONTENT "{\n  \"id\": \"cancellable.plugin\",\n  \"name\": \"Cancellable Plugin\",\n  \"version\": \"0.1.0\",\n  \"abiVersion\": \"4\",\n  \"library\": \"$<TARGET_FILE_NAME:plugmesh-cancellable-sample>\",\n  \"capabilities\": {\"http\": true, \"websocket\": true, \"sse\": true, \"fileStream\": true},\n  \"permissions\": [],\n  \"healthPath\": \"/health\"\n}\n")
add_custom_command(TARGET plugmesh-cancellable-sample POST_BUILD
  COMMAND ${CMAKE_COMMAND} -E make_directory "${CMAKE_CURRENT_BINARY_DIR}/plugins/cancellable.plugin"
  COMMAND ${CMAKE_COMMAND} -E copy "$<TARGET_FILE:plugmesh-cancellable-sample>" "${CMAKE_CURRENT_BINARY_DIR}/plugins/cancellable.plugin/$<TARGET_FILE_NAME:plugmesh-cancellable-sample>"
)

add_executable(plugmesh-plugin-host src/plugin_host_main.cpp)
target_link_libraries(plugmesh-plugin-host PRIVATE plugmesh_core)

if (UNIX AND NOT APPLE)
  # Linux artifacts carry OpenSSL beside the binaries; keep lookup relative to the package.
  foreach(target_name plugmesh-server plugmesh-plugin-host plugmesh-server-shared)
    if (TARGET ${target_name})
      set_target_properties(${target_name} PROPERTIES BUILD_RPATH "$ORIGIN" INSTALL_RPATH "$ORIGIN")
      # Keep the C++ runtime ABI out of the Linux package. The native build
      # still uses the selected glibc baseline for libc itself.
      target_link_options(${target_name} PRIVATE -static-libstdc++ -static-libgcc)
    endif()
  endforeach()
endif()

add_executable(plugmesh-plugin-loader-smoke tests/plugin_loader_smoke.cpp)
target_link_libraries(plugmesh-plugin-loader-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-host-smoke tests/plugin_host_smoke.cpp)
target_link_libraries(plugmesh-plugin-host-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-manager-smoke tests/plugin_manager_smoke.cpp)
target_link_libraries(plugmesh-plugin-manager-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-manager-crash-smoke tests/plugin_manager_crash_smoke.cpp)
target_link_libraries(plugmesh-plugin-manager-crash-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-websocket-lifecycle-smoke tests/plugin_websocket_lifecycle_smoke.cpp)
target_link_libraries(plugmesh-plugin-websocket-lifecycle-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-control-protocol-smoke tests/control_protocol_smoke.cpp)
target_link_libraries(plugmesh-control-protocol-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-control-client-smoke tests/control_client_smoke.cpp)
target_link_libraries(plugmesh-control-client-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-credential-store-smoke tests/credential_store_smoke.cpp)
target_link_libraries(plugmesh-credential-store-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-registration-client-smoke tests/registration_client_smoke.cpp)
target_link_libraries(plugmesh-registration-client-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-local-http-server-smoke tests/local_http_server_smoke.cpp)
target_link_libraries(plugmesh-local-http-server-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-local-ui-smoke-server tests/local_ui_smoke_server.cpp)
target_link_libraries(plugmesh-local-ui-smoke-server PRIVATE plugmesh_core)

if (TARGET plugmesh-server-shared)
  add_executable(plugmesh-server-api-smoke tests/server_api_smoke.cpp)
  target_link_libraries(plugmesh-server-api-smoke PRIVATE plugmesh-server-shared)
  add_dependencies(plugmesh-server-api-smoke plugmesh-sample)
endif()

add_test(NAME plugmesh-control-protocol-smoke COMMAND plugmesh-control-protocol-smoke)
add_test(NAME plugmesh-control-client-smoke COMMAND plugmesh-control-client-smoke $<TARGET_FILE:plugmesh-plugin-host> "${CMAKE_CURRENT_BINARY_DIR}/plugins")
add_test(NAME plugmesh-credential-store-smoke COMMAND plugmesh-credential-store-smoke)
add_test(NAME plugmesh-registration-client-smoke COMMAND plugmesh-registration-client-smoke "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/localhost-cert.pem" "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/localhost-key.pem")
add_test(NAME plugmesh-plugin-loader-smoke COMMAND plugmesh-plugin-loader-smoke $<TARGET_FILE:plugmesh-sample> $<TARGET_FILE:plugmesh-lifecycle-sample> $<TARGET_FILE:plugmesh-cancellable-sample>)
add_test(NAME plugmesh-plugin-host-smoke COMMAND plugmesh-plugin-host-smoke $<TARGET_FILE:plugmesh-plugin-host> $<TARGET_FILE:plugmesh-sample> $<TARGET_FILE:plugmesh-crashing-sample> $<TARGET_FILE:plugmesh-cancellable-sample>)
add_test(NAME plugmesh-plugin-manager-smoke COMMAND plugmesh-plugin-manager-smoke $<TARGET_FILE:plugmesh-plugin-host> "${CMAKE_CURRENT_BINARY_DIR}/plugins")
add_test(NAME plugmesh-plugin-manager-crash-smoke COMMAND plugmesh-plugin-manager-crash-smoke $<TARGET_FILE:plugmesh-plugin-host> "${CMAKE_CURRENT_BINARY_DIR}/plugins")
add_test(NAME plugmesh-plugin-websocket-lifecycle-smoke COMMAND plugmesh-plugin-websocket-lifecycle-smoke $<TARGET_FILE:plugmesh-plugin-host> "${CMAKE_CURRENT_BINARY_DIR}/plugins")
add_test(NAME plugmesh-local-http-server-smoke COMMAND plugmesh-local-http-server-smoke)
if (TARGET plugmesh-server-api-smoke)
  add_test(NAME plugmesh-server-api-smoke COMMAND plugmesh-server-api-smoke "${CMAKE_CURRENT_BINARY_DIR}/plugins")
endif()

if (WIN32)
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_WINDOWS=1)
  # websocketpp 在 MinGW 下默认回退 boost::thread，这里强制使用 C++11 <thread>。
  target_compile_definitions(plugmesh_core PUBLIC _WEBSOCKETPP_CPP11_THREAD_)
  target_link_libraries(plugmesh_core PRIVATE advapi32 ws2_32 mswsock crypt32)
  if (TARGET plugmesh-server)
    target_link_libraries(plugmesh-server PRIVATE shell32)
  endif()
else()
  # Linux 与 macOS 同为 POSIX：凭据文件权限走同一分支。
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_POSIX=1)
  if (APPLE)
    target_link_libraries(plugmesh_core PRIVATE "-framework Security" "-framework CoreFoundation")
  else()
    target_link_libraries(plugmesh_core PRIVATE ${CMAKE_DL_LIBS})
  endif()
endif()

# 所有用例都应在数十秒内跑完；统一设置 ctest 兜底超时，
# 避免某个用例僵死时把 CI 拖满 ctest 默认的 1500 秒。
get_property(plugmesh_tests DIRECTORY PROPERTY TESTS)
if (plugmesh_tests)
  set_tests_properties(${plugmesh_tests} PROPERTIES TIMEOUT 180)
endif()
