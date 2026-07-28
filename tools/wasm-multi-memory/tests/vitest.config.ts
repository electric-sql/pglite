export default {
  root: new URL('.', import.meta.url).pathname,
  test: {
    include: ['**/*.test.ts'],
    globalSetup: ['./support/build-artifacts.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
}
