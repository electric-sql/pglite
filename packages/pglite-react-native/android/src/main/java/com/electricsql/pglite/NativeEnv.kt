package com.electricsql.pglite

import android.content.Context
import java.io.File

object NativeEnv {
  init {
    // Ensure library is loaded so JNI registration is ready
    System.loadLibrary("PGLiteReactNative")
  }

  @JvmStatic external fun applyEnv(runtimeDir: String?, dataDir: String?, pgdata: String?)

  fun applyFromContext(context: Context) {
    val runtime = RuntimeResources.prepare(context)
    val dataDir = context.filesDir
    val pgdata = File(dataDir, "pglite/pgdata")
    pgdata.mkdirs()
    applyEnv(runtime.absolutePath, dataDir.absolutePath, pgdata.absolutePath)
  }
}

