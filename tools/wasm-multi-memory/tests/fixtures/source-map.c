#include <stdint.h>

__attribute__((used)) int32_t source_map_read(const int32_t* pointer) {
  return *pointer;
}

__attribute__((used)) void source_map_write(int32_t* pointer, int32_t value) {
  *pointer = value;
}
