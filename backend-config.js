// The backend serves the frontend from the same origin. This also works in
// the page and service-worker scopes when the Quick Tunnel hostname changes.
globalThis.BOREAS_BACKEND_URL = globalThis.location.origin;
