package com.electricsql.pglite

import java.io.File

object FileUtils {
  fun ensureDir(dir: File): File {
    if (!dir.exists()) dir.mkdirs()
    return dir
  }
}

