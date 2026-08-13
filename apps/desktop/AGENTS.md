# Desktop entry boundary

- `main.cjs` and `preload.cjs` are the only desktop entry files exposed by the package manifest.
- Renderer code cannot import Node filesystem, child process, SQLite, provider credentials, or arbitrary Electron APIs.
- Keep the current `electron/` implementation as a rollback boundary until the migration record's deletion gates pass.
- Any change to the preload allowlist requires a packaged IPC smoke and a user-path UI smoke.
