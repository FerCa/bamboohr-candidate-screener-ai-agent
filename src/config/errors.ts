// src/config/errors.ts
// Named error class for fail-fast config-loading failures (D-08, D-09).
// Thrown by src/config/loader.ts loadConfig(); caught by src/index.ts main().catch.
// Replaces the previous process.exit(1) calls so loader.ts has no side effects.

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
