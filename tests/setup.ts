// Registers @testing-library/jest-dom matchers (toBeInTheDocument, ...)
// onto vitest's expect for every test file.
import "@testing-library/jest-dom/vitest";

// jsdom has no layout engine, so the scroll helpers used by the chat and the
// itinerary card do not exist. Stub them for component tests; node-environment
// suites load this file too, where Element is absent.
if (typeof Element !== "undefined") {
  Object.defineProperty(Element.prototype, "scrollTo", { value: () => {}, writable: true });
  Object.defineProperty(Element.prototype, "scrollIntoView", { value: () => {}, writable: true });
}

