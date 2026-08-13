// Compatibility entry: the runnable Electron main process now lives under
// apps/desktop. Keep this path for older scripts and rollback.
require("../apps/desktop/main.cjs");
