package com.electricsql.pglite

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.util.Log
import com.margelo.nitro.com.electricsql.pglite.PGLiteReactNativeOnLoad

/**
 * ContentProvider to force-load the PGLite native library at app start,
 * before JS executes. This ensures JNI_OnLoad runs and constructors are registered.
 */
class InitProvider : ContentProvider() {
  override fun onCreate(): Boolean {
    return try {
      Log.i("PGLiteReactNative", "InitProvider: Initializing native library via Kotlin...")
      PGLiteReactNativeOnLoad.initializeNative()
      // Prepare runtime assets and export env to native via JNI
      NativeEnv.applyFromContext(context!!)
      true
    } catch (e: Throwable) {
      Log.e("PGLiteReactNative", "InitProvider failed to initialize native library", e)
      false
    }
  }

  override fun query(uri: Uri, projection: Array<out String>?, selection: String?, selectionArgs: Array<out String>?, sortOrder: String?): Cursor? = null
  override fun getType(uri: Uri): String? = null
  override fun insert(uri: Uri, values: ContentValues?): Uri? = null
  override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
  override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

