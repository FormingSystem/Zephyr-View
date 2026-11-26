# SPDX-License-Identifier: Apache-2.0
if(CONFIG_ONBOARDING_GREETING)
  zephyr_include_directories(include)
  zephyr_library()
  zephyr_library_sources(src/greeting.c)
endif()
