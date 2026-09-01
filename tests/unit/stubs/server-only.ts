// Test-only stub for the "server-only" package. The real package throws
// unconditionally unless resolved under Next's "react-server" bundler
// condition (see next.config.ts's build pipeline) — Vitest runs plain
// Node/jsdom, so it needs a no-op here instead, aliased in
// vitest.config.ts. This never ships in the app itself.
export {};
