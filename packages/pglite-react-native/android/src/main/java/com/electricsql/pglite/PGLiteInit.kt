package com.electricsql.pglite

import android.app.Application

class PGLiteInit : Application() {
  override fun onCreate() {
    super.onCreate()
    // Prepare assets and env for native backend
    Env.applyRuntimeEnv(this)
  }
}

