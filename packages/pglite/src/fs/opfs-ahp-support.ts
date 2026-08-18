interface FileSystemFileHandleConstructor {
  prototype: object
}

export function isOpfsAhpSupported(
  fileSystemFileHandle:
    | FileSystemFileHandleConstructor
    | undefined = typeof FileSystemFileHandle === 'undefined'
    ? undefined
    : FileSystemFileHandle,
): boolean {
  return (
    typeof (
      fileSystemFileHandle?.prototype as {
        createSyncAccessHandle?: unknown
      }
    )?.createSyncAccessHandle === 'function'
  )
}
