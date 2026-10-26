if(NOT DEFINED PLUGMESH_SOURCE_DIR OR NOT DEFINED PLUGMESH_BINARY_DIR)
  message(FATAL_ERROR "PLUGMESH_SOURCE_DIR and PLUGMESH_BINARY_DIR are required")
endif()

file(REMOVE_RECURSE "${PLUGMESH_BINARY_DIR}")
set(ui_dir "${PLUGMESH_BINARY_DIR}/fixture-ui")
file(MAKE_DIRECTORY "${ui_dir}/assets")
file(WRITE "${ui_dir}/index.html" "<!doctype html><html><head><title>before-marker</title></head><body><script src=\"assets/app.js\"></script></body></html>")
file(WRITE "${ui_dir}/assets/app.js" "before-marker")

set(configure_command
  "${CMAKE_COMMAND}"
  -S "${PLUGMESH_SOURCE_DIR}"
  -B "${PLUGMESH_BINARY_DIR}"
  -DPLUGMESH_BUILD_ARTIFACT=EXECUTABLE
  -DPLUGMESH_REQUIRE_EMBEDDED_UI=ON
  "-DPLUGMESH_NATIVE_UI_DIR=${ui_dir}"
  -DCMAKE_BUILD_TYPE=Release
)
if(DEFINED PLUGMESH_GENERATOR AND NOT PLUGMESH_GENERATOR STREQUAL "")
  list(APPEND configure_command -G "${PLUGMESH_GENERATOR}")
endif()
if(DEFINED PLUGMESH_GENERATOR_PLATFORM AND NOT PLUGMESH_GENERATOR_PLATFORM STREQUAL "")
  list(APPEND configure_command -A "${PLUGMESH_GENERATOR_PLATFORM}")
endif()
if(DEFINED PLUGMESH_GENERATOR_TOOLSET AND NOT PLUGMESH_GENERATOR_TOOLSET STREQUAL "")
  list(APPEND configure_command -T "${PLUGMESH_GENERATOR_TOOLSET}")
endif()
if(DEFINED PLUGMESH_CXX_COMPILER AND NOT PLUGMESH_CXX_COMPILER STREQUAL "")
  list(APPEND configure_command "-DCMAKE_CXX_COMPILER=${PLUGMESH_CXX_COMPILER}")
endif()
if(DEFINED PLUGMESH_TOOLCHAIN_FILE AND NOT PLUGMESH_TOOLCHAIN_FILE STREQUAL "")
  list(APPEND configure_command "-DCMAKE_TOOLCHAIN_FILE=${PLUGMESH_TOOLCHAIN_FILE}")
endif()
if(DEFINED PLUGMESH_PREFIX_PATH AND NOT PLUGMESH_PREFIX_PATH STREQUAL "")
  list(APPEND configure_command "-DCMAKE_PREFIX_PATH=${PLUGMESH_PREFIX_PATH}")
endif()
if(DEFINED PLUGMESH_OPENSSL_ROOT_DIR AND NOT PLUGMESH_OPENSSL_ROOT_DIR STREQUAL "")
  list(APPEND configure_command "-DOPENSSL_ROOT_DIR=${PLUGMESH_OPENSSL_ROOT_DIR}")
endif()
execute_process(
  COMMAND ${configure_command}
  RESULT_VARIABLE configure_result
  OUTPUT_VARIABLE configure_output
  ERROR_VARIABLE configure_error
)
if(NOT configure_result EQUAL 0)
  message(FATAL_ERROR "Embedded UI rebuild fixture configuration failed:\n${configure_output}\n${configure_error}")
endif()

function(build_embedded_assets)
  execute_process(
    COMMAND "${CMAKE_COMMAND}" --build "${PLUGMESH_BINARY_DIR}" --config Release --target plugmesh-embedded-ui-assets --parallel 2
    RESULT_VARIABLE build_result
    OUTPUT_VARIABLE build_output
    ERROR_VARIABLE build_error
  )
  if(NOT build_result EQUAL 0)
    message(FATAL_ERROR "Embedded UI asset generation failed:\n${build_output}\n${build_error}")
  endif()
endfunction()

set(embedded_file "${PLUGMESH_BINARY_DIR}/generated/embedded_ui_assets.inc")
build_embedded_assets()
file(READ "${embedded_file}" first_generation)
string(FIND "${first_generation}" "before-marker" before_index)
if(before_index EQUAL -1)
  message(FATAL_ERROR "Initial embedded asset table does not contain the original marker")
endif()

execute_process(COMMAND "${CMAKE_COMMAND}" -E sleep 1)
file(WRITE "${ui_dir}/index.html" "<!doctype html><html><head><title>after-marker</title></head><body><script src=\"assets/app.js\"></script></body></html>")
file(WRITE "${ui_dir}/assets/app.js" "after-marker")
build_embedded_assets()
file(READ "${embedded_file}" second_generation)
string(FIND "${second_generation}" "after-marker" after_index)
string(FIND "${second_generation}" "before-marker" stale_index)
if(after_index EQUAL -1 OR NOT stale_index EQUAL -1)
  message(FATAL_ERROR "Same-name UI content change did not refresh the embedded asset table")
endif()
