package com.electricsql.pglite

import android.content.Context
import java.io.File

object Env {
  fun applyRuntimeEnv(context: Context) {
    val runtime = RuntimeResources.prepare(context)
    val pgdata = FileUtils.ensureDir(File(context.filesDir, "pglite/pgdata"))

    // Export env vars for native layer via System properties forwarded by JNI
    System.setProperty("ANDROID_RUNTIME_DIR", runtime.absolutePath)
    System.setProperty("ANDROID_DATA_DIR", context.filesDir.absolutePath)

    // These are read by RuntimeResources.cpp via getenv (through JNI glue, if present)
    System.setProperty("PGDATA", pgdata.absolutePath)
  }
}

