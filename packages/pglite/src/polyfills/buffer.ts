// Buffer polyfill for browsers
import { Buffer as BrowserBuffer } from "buffer/"; // note: the trailing slash is important to reference the installed package instead of the built-in module

let Buffer: BufferConstructor;

if (globalThis.Buffer) {
  Buffer = globalThis.Buffer;
} else {
  Buffer = BrowserBuffer as any;
}

export { Buffer };
