// import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// https://testing-library.com/docs/react-testing-library/api#cleanup
afterEach(() => cleanup())