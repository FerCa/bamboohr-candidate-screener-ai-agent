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
