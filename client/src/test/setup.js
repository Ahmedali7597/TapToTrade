import "@testing-library/jest-dom";
import { TextDecoder, TextEncoder } from "node:util";

// jsdom lacks these; react-router uses TextEncoder, and Magic UI's scroll-triggered animations use IntersectionObserver.
Object.assign(globalThis, { TextEncoder, TextDecoder });
globalThis.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
};
