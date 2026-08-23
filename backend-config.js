const _boreasOrigin = globalThis.location?.origin || "";
Object.defineProperty(globalThis, "BOREAS_BACKEND_URL", {
  value: _boreasOrigin,
  writable: false,
  configurable: false,
  enumerable: true,
});
