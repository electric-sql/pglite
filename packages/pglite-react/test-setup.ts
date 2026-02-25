import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Polyfill File.prototype.arrayBuffer for jsdom
// jsdom's File implementation doesn't properly support arrayBuffer()
if (typeof File !== 'undefined' && !File.prototype.arrayBuffer) {
  File.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as ArrayBuffer)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

// https://testing-library.com/docs/react-testing-library/api#cleanup
afterEach(() => cleanup())