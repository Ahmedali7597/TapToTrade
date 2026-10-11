import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";

// jsdom lacks these; react-router uses TextEncoder, Magic UI's scroll-triggered animations use IntersectionObserver,
// and Radix's Switch measures itself with ResizeObserver.
Object.assign(globalThis, { TextEncoder, TextDecoder });
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
