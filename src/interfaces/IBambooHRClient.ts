// src/interfaces/IBambooHRClient.ts
// Structural interface mirroring the public surface of src/bamboohr/client.ts BambooHRClient.
// No `implements` keyword on BambooHRClient — TypeScript structural typing satisfies this
// interface implicitly (D-05). This interface enables dependency injection in
// CandidateProcessor and JobRunner, and unit-test mocking via vi.fn().
import type { JobConfig } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';

export interface IBambooHRClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  postComment(applicationId: number, comment: string): Promise<void>;
  moveStage(applicationId: number, stageId: number): Promise<void>;
  validateStages(job: JobConfig): Promise<Map<string, number>>;
  fetchApplicationDetails(id: number): Promise<BambooHRApplication>;
  downloadPdf(
    applicationId: number,
    applicantId: number,
    fileId: number,
  ): Promise<{ buffer: Buffer; contentType: string }>;
  fetchCandidates(
    jobId: string,
    statusId: string,
  ): Promise<BambooHRApplication[]>;
}
