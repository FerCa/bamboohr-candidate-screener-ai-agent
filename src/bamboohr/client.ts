// src/bamboohr/client.ts
// BambooHR ATS API client using Node.js built-in fetch.
// Auth: Basic base64("apiKey:x") per official BambooHR docs.
// All requests MUST include Accept: application/json (API defaults to XML).
// Source: documentation.bamboohr.com/docs/getting-started
import type { Config } from '../config/schema.js';
import type {
  BambooHRApplication,
  BambooHRStatus,
  ApplicationsResponse,
} from './types.js';
import { StageValidationError } from './errors.js';

/**
 * BambooHR ATS API client.
 * Structurally satisfies IBambooHRClient (no `implements` keyword needed — D-05).
 */
export class BambooHRClient {
  private readonly baseUrl: string;
  private readonly hiringBaseUrl: string;
  private readonly authHeader: string;

  /** Safety ceiling: abort pagination if BambooHR API never signals paginationComplete. */
  private static readonly MAX_PAGES = 100;

  constructor(subdomain: string, apiKey: string) {
    // Official URL format: {subdomain}.bamboohr.com/api/v1
    // NOT the legacy: api.bamboohr.com/api/gateway.php/{domain}/v1
    // [CITED: documentation.bamboohr.com Update Applicant Status endpoint]
    this.baseUrl = `https://${subdomain}.bamboohr.com/api/v1`;
    // Resume downloads use the hiring web API, not the ATS REST API.
    // Confirmed by browser network inspection: /hiring/api/applications/{id}/files/{fileId}/download
    this.hiringBaseUrl = `https://${subdomain}.bamboohr.com/hiring/api`;
    // BambooHR Basic auth: API key as username, literal string "x" as password
    // [CITED: documentation.bamboohr.com/docs/getting-started]
    this.authHeader = 'Basic ' + Buffer.from(`${apiKey}:x`).toString('base64');
  }

  /**
   * Generic authenticated GET request.
   * Sets Accept: application/json on every call — required; API defaults to XML.
   */
  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(k, v);
      }
    }
    const res = await fetch(url.toString(), {
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',  // REQUIRED — omitting causes XML response + JSON.parse failure
      },
    });
    if (!res.ok) {
      throw new Error(
        `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
      );
    }
    return res.json() as Promise<T>;
  }

  /**
   * Generic authenticated POST request.
   * Sets Accept and Content-Type to application/json (BambooHR defaults to XML without Accept).
   * Throws on non-2xx — caller's per-candidate try/catch handles it.
   */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(
        `BambooHR API error: HTTP ${res.status} ${res.statusText} on POST ${path}`,
      );
    }
    return res.json() as Promise<T>;
  }

  /**
   * BAMB-03: Post a recruiter-visible comment on an application.
   * Endpoint: POST /applicant_tracking/applications/{applicationId}/comments
   * Body: { type: "comment", comment: <text> }
   * [CITED: documentation.bamboohr.com/reference/post-application-comment]
   */
  async postComment(applicationId: number, comment: string): Promise<void> {
    await this.post<unknown>(
      `/applicant_tracking/applications/${applicationId}/comments`,
      { type: 'comment', comment },
    );
  }

  /**
   * BAMB-02: Move an application to a new pipeline stage.
   * Endpoint: POST /applicant_tracking/applications/{applicationId}/status
   * Body: { status: <stageId integer> }
   * stageId comes from stageMap built by validateStages() — no extra API call.
   * [CITED: documentation.bamboohr.com/reference/update-applicant-status]
   */
  async moveStage(applicationId: number, stageId: number): Promise<void> {
    await this.post<unknown>(
      `/applicant_tracking/applications/${applicationId}/status`,
      { status: stageId },
    );
  }

  /**
   * CONF-02: Fetch live pipeline stages and compare against config stage names.
   * Exits with code 1 if any configured stage name is not found in the live API.
   * Call this once at startup, before the candidate loop.
   * Returns Map<stageName, stageId> — consumed by index.ts to avoid duplicate API call (WR-03).
   */
  async validateStages(config: Config): Promise<Map<string, number>> {
    let statuses: BambooHRStatus[] = [];
    try {
      statuses = await this.get<BambooHRStatus[]>('/applicant_tracking/statuses');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new StageValidationError(
        `Failed to fetch pipeline stages: ${message}`,
      );
    }

    const nameSet = new Set(statuses.map((s) => s.name));
    const available = [...nameSet].join(', ');
    let hasError = false;

    for (const [key, stageName] of Object.entries(config.job.stages)) {
      if (!nameSet.has(stageName)) {
        console.error(
          `[bamboohr] Stage "${stageName}" (config.job.stages.${key}) not found in BambooHR.`,
        );
        console.error(`[bamboohr] Available stages: ${available}`);
        hasError = true;
      }
    }

    if (hasError) {
      throw new StageValidationError(
        `One or more configured stage names were not found in BambooHR. Available stages: ${available}`,
      );
    }

    // Return Map<stageName, stageId> — consumed by index.ts to avoid duplicate API call (WR-03)
    return new Map(statuses.map((s) => [s.name, s.id]));
  }

  /**
   * Fetch full application detail for a single application.
   * The list endpoint returns summary data only; custom questions, desiredSalary,
   * resumeFileId, and full address are only available on the detail endpoint.
   */
  async fetchApplicationDetails(id: number): Promise<BambooHRApplication> {
    return this.get<BambooHRApplication>(`/applicant_tracking/applications/${id}`);
  }

  /**
   * BAMB-04: Download a candidate's CV as a binary Buffer.
   * Uses the BambooHR hiring web API confirmed by browser network inspection:
   *   GET /hiring/api/applications/{applicationId}/files/{resumeFileId}/download
   *
   * resumeFileId from the application detail maps directly to this endpoint.
   * Basic Auth works here (same credentials as the ATS REST API).
   * Does NOT set Accept: application/json — binary PDF response.
   */
  async downloadPdf(
    applicationId: number,
    _applicantId: number,
    fileId: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    const url = `${this.hiringBaseUrl}/applications/${applicationId}/files/${fileId}/download`;
    const res = await fetch(url, {
      headers: { Authorization: this.authHeader },
    });

    if (!res.ok) {
      console.error(
        `[bamboohr] downloadPdf: HTTP ${res.status} for applicationId=${applicationId}, fileId=${fileId}`,
      );
      throw new Error(
        `BambooHR PDF download error: HTTP ${res.status} ${res.statusText} ` +
        `(applicationId=${applicationId}, fileId=${fileId})`,
      );
    }

    const contentType = res.headers.get('content-type') ?? '';
    const arrayBuffer = await res.arrayBuffer();
    return { buffer: Buffer.from(arrayBuffer), contentType };
  }

  /**
   * BAMB-01: Fetch all applications in a given stage for a job opening.
   * Loops until paginationComplete === true using integer page parameter.
   * Returns flat array of all applications across all pages.
   * [CITED: bamboozled-cr — paginationComplete boolean + page integer]
   */
  async fetchCandidates(
    jobId: string,
    statusId: string,
  ): Promise<BambooHRApplication[]> {
    const applications: BambooHRApplication[] = [];
    let page = 1;

    while (page <= BambooHRClient.MAX_PAGES) {
      const data = await this.get<ApplicationsResponse>(
        '/applicant_tracking/applications',
        {
          jobId,
          applicationStatusId: statusId,
          page: String(page),
        },
      );
      applications.push(...data.applications);
      if (data.paginationComplete) break;
      page++;
    }

    if (page > BambooHRClient.MAX_PAGES) {
      console.error(
        `[bamboohr] fetchCandidates: reached MAX_PAGES (${BambooHRClient.MAX_PAGES}) without paginationComplete — aborting pagination. Results may be incomplete.`,
      );
    }

    return applications;
  }
}
