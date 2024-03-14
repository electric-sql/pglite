// Buffer polyfill for browsers
import { Buffer as AltBuffer } from "buffer/"; // note: the trailing slash is important to reference the installed package instead of the built-in module

let Buffer;

if (globalThis.Buffer) {
  Buffer = globalThis.Buffer;
} else {
  Buffer = AltBuffer;
}

export { Buffer };
