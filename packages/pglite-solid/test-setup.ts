import { afterEach } from 'vitest'
import { cleanup } from '@solidjs/testing-library'

// https://testing-library.com/docs/solid-testing-library/api#cleanup
afterEach(() => cleanup())
