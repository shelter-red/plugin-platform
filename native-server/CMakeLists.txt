cmake_minimum_required(VERSION 3.16)
project(plugmesh_server LANGUAGES CXX)

enable_testing()

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

add_library(plugmesh_core STATIC
  src/control_client.cpp
  src/control_protocol.cpp
  src/credential_store.cpp
  src/local_http_server.cpp
  src/plugin_loader.cpp
  src/plugin_manager.cpp
  src/registration_client.cpp
  src/server_config.cpp
)
target_compile_definitions(plugmesh_core PUBLIC ASIO_STANDALONE)
target_include_directories(plugmesh_core PUBLIC include third_party/include)
target_link_libraries(plugmesh_core PUBLIC OpenSSL::SSL OpenSSL::Crypto Threads::Threads)

add_executable(plugmesh-server src/main.cpp)
target_link_libraries(plugmesh-server PRIVATE plugmesh_core)

add_library(plugmesh-sample SHARED examples/sample_plugin.cpp)
target_include_directories(plugmesh-sample PRIVATE include)

add_library(plugmesh-lifecycle-sample SHARED examples/lifecycle_plugin.cpp)
target_include_directories(plugmesh-lifecycle-sample PRIVATE include)

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

add_executable(plugmesh-plugin-loader-smoke tests/plugin_loader_smoke.cpp)
target_link_libraries(plugmesh-plugin-loader-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-manager-smoke tests/plugin_manager_smoke.cpp)
target_link_libraries(plugmesh-plugin-manager-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-plugin-websocket-lifecycle-smoke tests/plugin_websocket_lifecycle_smoke.cpp)
target_link_libraries(plugmesh-plugin-websocket-lifecycle-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-control-protocol-smoke tests/control_protocol_smoke.cpp)
target_link_libraries(plugmesh-control-protocol-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-credential-store-smoke tests/credential_store_smoke.cpp)
target_link_libraries(plugmesh-credential-store-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-registration-client-smoke tests/registration_client_smoke.cpp)
target_link_libraries(plugmesh-registration-client-smoke PRIVATE plugmesh_core)

add_executable(plugmesh-local-http-server-smoke tests/local_http_server_smoke.cpp)
target_link_libraries(plugmesh-local-http-server-smoke PRIVATE plugmesh_core)

add_test(NAME plugmesh-control-protocol-smoke COMMAND plugmesh-control-protocol-smoke)
add_test(NAME plugmesh-credential-store-smoke COMMAND plugmesh-credential-store-smoke)
add_test(NAME plugmesh-registration-client-smoke COMMAND plugmesh-registration-client-smoke)
add_test(NAME plugmesh-plugin-loader-smoke COMMAND plugmesh-plugin-loader-smoke $<TARGET_FILE:plugmesh-sample>)
add_test(NAME plugmesh-plugin-manager-smoke COMMAND plugmesh-plugin-manager-smoke "${CMAKE_CURRENT_BINARY_DIR}/plugins")
add_test(NAME plugmesh-plugin-websocket-lifecycle-smoke COMMAND plugmesh-plugin-websocket-lifecycle-smoke "${CMAKE_CURRENT_BINARY_DIR}/plugins")
add_test(NAME plugmesh-local-http-server-smoke COMMAND plugmesh-local-http-server-smoke)

if (WIN32)
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_WINDOWS=1)
  target_link_libraries(plugmesh_core PRIVATE Advapi32)
elseif(APPLE)
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_MACOS=1)
  target_link_libraries(plugmesh_core PRIVATE "-framework Security" "-framework CoreFoundation")
else()
  target_compile_definitions(plugmesh_core PRIVATE PLUGMESH_PLATFORM_POSIX=1)
  target_link_libraries(plugmesh_core PRIVATE ${CMAKE_DL_LIBS})
endif()
