/* This file is a polyfill for AVA tests to run in Bun */

let test

if (typeof Bun !== 'undefined') {
  // Minimal implementation of AVA for Bun
  const bunTest = await import('bun:test')

  const t = {
    is: (a, b) => bunTest.expect(a).toBe(b),
    deepEqual: (a, b) => bunTest.expect(a).toEqual(b),
    like: (a, b) => bunTest.expect(a).toMatchObject(b),
    pass: () => bunTest.expect(true).toBe(true),
    fail: () => bunTest.expect(true).toBe(false),
    throwsAsync: async (fn, expected) => {
      try {
        await fn()
        bunTest.expect(true).toBe(false)
      } catch (err) {
        bunTest.expect(err).toMatchObject(expected)
      }
    },
  }

  test = (name, fn) => {
    return bunTest.test(name, () => fn(t))
  }
  test.before = (fn) => bunTest.beforeAll(() => fn(t))
  test.after = (fn) => bunTest.afterAll(() => fn(t))
  test.serial = test
  test.serial.before = (fn) => bunTest.beforeEach(() => fn(t))
} else {
  // Just use AVA
  test = (await import('ava')).default
}

export default test
