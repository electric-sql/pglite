import { IN_NODE } from "./utils.js";

let PGEvent: typeof CustomEvent;

// Older versions of Node.js do not have CustomEvent
if (IN_NODE && typeof CustomEvent === "undefined") {
  PGEvent = class CustomEvent<T> extends Event {
    #detail: T | null;

    constructor(type: string, options?: EventInit & { detail: T }) {
      super(type, options);
      this.#detail = options?.detail ?? null;
    }

    get detail() {
      return this.#detail;
    }
  } as typeof CustomEvent;
} else {
  PGEvent = CustomEvent;
}

export { PGEvent };
