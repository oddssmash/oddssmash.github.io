// Preloaded in the data workflow (NODE_OPTIONS=--import): every fetch() without its own signal gets a 30-second timeout, so a
// stalled request fails and is retried or skipped instead of hanging a whole step. Calls that pass a signal keep it.
const orig = globalThis.fetch;
globalThis.fetch = (url, opts = {}) => orig(url, opts.signal ? opts : { ...opts, signal: AbortSignal.timeout(Number(process.env.FETCH_TIMEOUT_MS || 30000)) });
