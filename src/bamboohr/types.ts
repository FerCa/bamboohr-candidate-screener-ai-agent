// src/bamboohr/types.ts
// BambooHR ATS API response type interfaces.
// Field names are ASSUMED from integration guides + Crystal wrapper source.
// Verify against live API on first DRY_RUN=true run and update if needed.
// Sources: bamboozled-cr (github.com/mdwagner/bamboozled-cr), BambooHR docs

/**
 * A single pipeline stage returned by GET /applicant_tracking/statuses
 * [MEDIUM confidence — structure from BambooHR integration guide search results]
 */
export interface BambooHRStatus {
  id: number;
  name: string;
  code: string;
  description: string;
  enabled: boolean;
  manageability: string;
  translatedName: string;
}

/**
 * An application record from GET /applicant_tracking/applications or
 * GET /applicant_tracking/applications/:id
 *
 * IMPORTANT: `id` here is the applicationId — the entity used for writes.
 * `applicant.id` is the applicantId — for logging and reference only.
 * [ASSUMED — field names inferred from integration guides; verify on first run]
 */
export interface BambooHRApplication {
  id: number;           // applicationId — use for stage writes and comment posts
  applicant: {
    id: number;         // applicantId — log only; NOT used for BambooHR writes
    firstName: string;
    lastName: string;
    email: string;
  };
  status: {
    id: number;
    label: string;      // e.g. "New", "Schedule Phone Screen", "Reviewed"
  };
  // NOTE: Additional fields (questions[], resume fileId, etc.) are account-specific.
  // On first DRY_RUN, log JSON.stringify(application, null, 2) to discover actual paths.
  // fieldMap in config.yaml maps readable names to those actual paths.
  [key: string]: unknown;
}

/**
 * Envelope for GET /applicant_tracking/applications (list with pagination)
 * [CITED: bamboozled-cr — paginationComplete boolean field]
 */
export interface ApplicationsResponse {
  applications: BambooHRApplication[];
  paginationComplete: boolean;
}
