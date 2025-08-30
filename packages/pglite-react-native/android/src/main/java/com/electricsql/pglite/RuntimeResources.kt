package com.electricsql.pglite

import android.content.Context
import android.os.Build
import java.io.File
import java.io.FileOutputStream

object RuntimeResources {
  // Copy assets at assets/pglite/share/postgresql/** into filesDir/pglite/runtime/share/postgresql/**
  fun prepare(context: Context): File {
    val runtimeRoot = File(context.filesDir, "pglite/runtime")
    val shareDst = File(runtimeRoot, "share/postgresql")
    shareDst.mkdirs()

    var copied = false
    try {
      // Primary path: assets packaged under src/main/assets/pglite/share/postgresql/**
      copied = copyAssetDir(context, "pglite/share/postgresql", shareDst)
      // Fallback: if build.gradle added the dist runtime as an assets root, catalogs
      // will be under "share/postgresql/**" at the root of that assets dir.
      if (!copied) copied = copyAssetDir(context, "share/postgresql", shareDst)


      // Ensure time zone abbreviation sets are present at share/postgresql/timezonesets
      run {
        val tzsetsDst = File(shareDst, "timezonesets")
        tzsetsDst.mkdirs()
        var tzCopied = copyAssetDir(context, "pglite/share/timezonesets", tzsetsDst)
        if (!tzCopied) tzCopied = copyAssetDir(context, "share/timezonesets", tzsetsDst)
      }

      // Ensure postgres.bki exists; some builds place it at share/postgres.bki
      val bki = File(shareDst, "postgres.bki")
      if (!bki.exists()) {
        if (!copySingleAsset(context, "pglite/share/postgres.bki", bki)) {
          copySingleAsset(context, "share/postgres.bki", bki)
        }
      }

      // Also copy the base cluster snapshot tar if packaged
      val tarDst = File(runtimeRoot, "PGLiteDataDir.tar")
      if (!tarDst.exists()) {
        if (!copySingleAsset(context, "pglite/PGLiteDataDir.tar", tarDst)) {
          // fallback if assets root points at runtime
          copySingleAsset(context, "PGLiteDataDir.tar", tarDst)
        }
      }
    } catch (_: Exception) {
      // best-effort
    }

    return runtimeRoot
  }

  private fun copyAssetDir(context: Context, assetPath: String, destDir: File): Boolean {
    val assetManager = context.assets
    val list = try { assetManager.list(assetPath) } catch (_: Exception) { null } ?: return false
    if (list.isEmpty()) return false
    var any = false
    for (name in list) {
      val subPath = if (assetPath.isEmpty()) name else "$assetPath/$name"
      val dest = File(destDir, name)
      val children = try { assetManager.list(subPath) } catch (_: Exception) { null }
      if (children != null && children.isNotEmpty()) {
        dest.mkdirs()
        if (copyAssetDir(context, subPath, dest)) any = true
      } else {
        assetManager.open(subPath).use { input ->
          FileOutputStream(dest).use { output -> input.copyTo(output) }
        }
        any = true
      }
    }
    return any
  }

  private fun copySingleAsset(context: Context, assetPath: String, destFile: File): Boolean {
    return try {
      val am = context.assets
      am.open(assetPath).use { input ->
        destFile.parentFile?.mkdirs()
        FileOutputStream(destFile).use { output -> input.copyTo(output) }
      }
      true
    } catch (_: Exception) {
      false
    }
  }
}

