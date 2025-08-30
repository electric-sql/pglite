// TODO: Runtime resources bundling/extraction
// Plan:
// - Android: package share/postgresql under android/src/main/assets/pglite/share/postgresql
//   Copy to Context.getFilesDir()/pglite/runtime on first-run.
// - iOS: package share/postgresql in the framework bundle and copy to
//   Application Support/PGLite/runtime on first-run.
// - Then set PGSYSCONFDIR=runtimeDir and ensure PGDATA exists before initdb.

export async function prepareRuntime(): Promise<void> {
  // Placeholder — native side currently prepares PGDATA/PGSYSCONFDIR minimally.
  // Wire platform-specific extraction later.
}

// Exposed for app-side use (optional): prepare runtime resources prior to DB init
export async function prepareNativeRuntime(): Promise<void> {
  // No-op in JS. On mobile, native side should copy resources and set env before initdb.
}
