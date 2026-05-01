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

export class BambooHRClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  /** Safety ceiling: abort pagination if BambooHR API never signals paginationComplete. */
  private static readonly MAX_PAGES = 100;

  constructor(subdomain: string, apiKey: string) {
    // Official URL format: {subdomain}.bamboohr.com/api/v1
    // NOT the legacy: api.bamboohr.com/api/gateway.php/{domain}/v1
    // [CITED: documentation.bamboohr.com Update Applicant Status endpoint]
    this.baseUrl = `https://${subdomain}.bamboohr.com/api/v1`;
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
   * CONF-02: Fetch live pipeline stages and compare against config stage names.
   * Exits with code 1 if any configured stage name is not found in the live API.
   * Call this once at startup, before the candidate loop.
   */
  async validateStages(config: Config): Promise<void> {
    let statuses: BambooHRStatus[];
    try {
      statuses = await this.get<BambooHRStatus[]>('/applicant_tracking/statuses');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bamboohr] Failed to fetch pipeline stages: ${message}`);
      process.exit(1);
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
      process.exit(1);
    }
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
   * Uses Basic Auth (same as all ATS endpoints).
   * Does NOT set Accept: application/json — binary response must not negotiate JSON.
   * Reads response body via arrayBuffer() (not json()) for binary content.
   *
   * IMPORTANT: The BambooHR ATS download endpoint path is NOT publicly documented.
   * The most-likely path is tried first; on 404 the attempted paths are logged so
   * the developer can discover the correct path on the first DRY_RUN.
   *
   * Assumptions (A1-A4 in RESEARCH.md):
   *   A1 — field name in application detail is 'resumeFileId' (camelCase)
   *   A2 — endpoint path is /applicant_tracking/applications/{applicationId}/documents/{fileId}
   *   A3 — same Basic Auth as all ATS endpoints
   *   A4 — response is direct binary (not redirect to signed URL)
   */
  async downloadPdf(
    applicationId: number,
    fileId: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    // Ordered list of paths to try — most likely first (A2 assumption).
    // If the first returns 404, try the second. If both fail, throw with
    // instructions for the developer to check BambooHR's Postman collection.
    const candidatePaths = [
      `/applicant_tracking/applications/${applicationId}/documents/${fileId}`,
      `/v1/employees/${applicationId}/files/${fileId}`,
    ];

    let lastStatus = 0;
    for (const path of candidatePaths) {
      const url = `${this.baseUrl}${path}`;
      const res = await fetch(url, {
        headers: {
          // Authorization REQUIRED — same Basic Auth as all ATS endpoints (A3)
          Authorization: this.authHeader,
          // NO Accept: application/json — binary response does not negotiate via Accept
        },
      });

      if (res.status === 404) {
        lastStatus = 404;
        console.error(
          `[bamboohr] downloadPdf: 404 on path ${path} (applicationId=${applicationId}, fileId=${fileId})`,
        );
        continue;
      }

      if (!res.ok) {
        throw new Error(
          `BambooHR PDF download error: HTTP ${res.status} ${res.statusText} ` +
          `(applicationId=${applicationId}, fileId=${fileId}, path=${path})`,
        );
      }

      const contentType = res.headers.get('content-type') ?? '';
      const arrayBuffer = await res.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), contentType };
    }

    // All candidate paths returned 404 — endpoint discovery required.
    console.error(
      `[bamboohr] downloadPdf: All candidate paths returned 404 for applicationId=${applicationId}, fileId=${fileId}.`,
    );
    console.error(
      `[bamboohr] Attempted paths:\n${candidatePaths.map((p) => `  ${this.baseUrl}${p}`).join('\n')}`,
    );
    console.error(
      `[bamboohr] To discover the correct path: check BambooHR Postman collection at ` +
      `https://documentation.bamboohr.com/docs/postman-collection ` +
      `or contact BambooHR support for the ATS attachment REST endpoint.`,
    );
    throw new Error(
      `BambooHR PDF download: endpoint not found (HTTP ${lastStatus}). ` +
      `Check stderr for attempted paths and discovery instructions.`,
    );
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
    const all: BambooHRApplication[] = [];
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
      all.push(...data.applications);
      if (data.paginationComplete) break;
      page++;
    }

    if (page > BambooHRClient.MAX_PAGES) {
      console.error(
        `[bamboohr] fetchCandidates: reached MAX_PAGES (${BambooHRClient.MAX_PAGES}) without paginationComplete — aborting pagination. Results may be incomplete.`,
      );
    }

    return all;
  }
}
