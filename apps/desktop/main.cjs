// Compatibility entry while the root Electron runtime is migrated package by package.
// Keeping the implementation in electron/main.cjs makes rollback to the old entry
// non-destructive; package.json points here so the target boundary is exercised now.
require("../../electron/main.cjs");
