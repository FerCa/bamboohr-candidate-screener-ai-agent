// src/bamboohr/errors.ts
// Named error class for BambooHR pipeline-stage validation failures (D-08, D-09).
// Thrown by src/bamboohr/client.ts validateStages(); caught by src/index.ts main().catch.
// Replaces the previous process.exit(1) calls so client.ts has no entry-point side effects.

export class StageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageValidationError';
  }
}
