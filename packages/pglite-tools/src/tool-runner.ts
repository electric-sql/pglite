export interface PostgresToolInvocation {
  readonly argv: readonly string[]
  readonly env: Readonly<Record<string, string | undefined>>
  readonly stdin: NodeJS.ReadableStream
  readonly stdout: NodeJS.WritableStream
  readonly stderr: NodeJS.WritableStream
  readonly signal?: AbortSignal
  readonly cwd?: string | URL
}

export interface PostgresToolRunner {
  readonly command: string
  run(invocation: PostgresToolInvocation): Promise<number>
}
