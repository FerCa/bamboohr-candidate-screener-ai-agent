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
   * Returns Map<stageName, stageId> — consumed by index.ts to avoid duplicate API call (WR-03).
   */
  async validateStages(config: Config): Promise<Map<string, number>> {
    let statuses: BambooHRStatus[] = [];
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
   * GAP-02: Fetch document list for an application.
   * BambooHR requires fetching this list first; the list items contain the actual
   * download URL or endpoint — resumeFileId alone is not a usable download path.
   *
   * Response shape is undocumented. Returns `unknown` so the caller can handle
   * multiple possible shapes (array, object with items[], etc.) defensively.
   */
  async getApplicationDocuments(applicationId: number): Promise<unknown> {
    return this.get<unknown>(
      `/applicant_tracking/applications/${applicationId}/documents`,
    );
  }

  /**
   * BAMB-04: Download a candidate's CV as a binary Buffer.
   * Uses a two-step process (GAP-02 fix):
   *   Step 1 — getApplicationDocuments() fetches the documents list for the application
   *   Step 2 — The document object's actual download URL is used for the binary fetch
   *
   * resumeFileId from the application detail is NOT a direct download endpoint ID.
   * The documents list endpoint returns objects with the actual download URL.
   *
   * Does NOT set Accept: application/json on the binary download step.
   * Reads response body via arrayBuffer() for binary content.
   */
  async downloadPdf(
    applicationId: number,
    applicantId: number,
    fileId: number,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    // --- Step 1: Fetch documents list ---
    let docsRaw: unknown;
    try {
      docsRaw = await this.getApplicationDocuments(applicationId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[bamboohr] downloadPdf: documents list fetch failed for applicationId=${applicationId}: ${message}`,
      );
      throw new Error(
        `BambooHR PDF download: documents list fetch failed (applicationId=${applicationId}). ` +
        `Original error: ${message}`,
      );
    }

    // Normalise to array — BambooHR may return [] directly or { data: [], documents: [], items: [] }
    let docs: unknown[];
    if (Array.isArray(docsRaw)) {
      docs = docsRaw;
    } else if (docsRaw !== null && typeof docsRaw === 'object') {
      const wrapper = docsRaw as Record<string, unknown>;
      const inner =
        wrapper['data'] ??
        wrapper['documents'] ??
        wrapper['items'] ??
        wrapper['files'];
      docs = Array.isArray(inner) ? inner : [];
    } else {
      docs = [];
    }

    if (docs.length === 0) {
      console.error(
        `[bamboohr] downloadPdf: documents list is empty for applicationId=${applicationId}, applicantId=${applicantId}, fileId=${fileId}.`,
      );
      console.error(
        `[bamboohr] downloadPdf: raw documents response shape: ${JSON.stringify(docsRaw)}`,
      );
      throw new Error(
        `BambooHR PDF download: no documents found for applicationId=${applicationId}. ` +
        `Check stderr for the raw response shape.`,
      );
    }

    // Helper: extract any usable download URL from a document object
    const extractUrl = (doc: unknown): string | null => {
      if (doc === null || typeof doc !== 'object') return null;
      const d = doc as Record<string, unknown>;
      for (const field of ['url', 'downloadUrl', 'download_url', 'original', 'href', 'link', 'fileUrl', 'file_url']) {
        const val = d[field];
        if (typeof val === 'string' && val.length > 0) return val;
      }
      return null;
    };

    // Helper: check whether a document's ID matches the resumeFileId
    const matchesFileId = (doc: unknown, id: number): boolean => {
      if (doc === null || typeof doc !== 'object') return false;
      const d = doc as Record<string, unknown>;
      return d['id'] === id || d['fileId'] === id || d['file_id'] === id;
    };

    // Prefer a document whose ID matches resumeFileId; fall back to first with any URL
    let downloadUrl: string | null = null;
    let matchedDoc: unknown = null;

    // Priority 1: exact ID match
    for (const doc of docs) {
      if (matchesFileId(doc, fileId)) {
        const url = extractUrl(doc);
        if (url !== null) {
          downloadUrl = url;
          matchedDoc = doc;
          break;
        }
      }
    }

    // Priority 2: first document with a usable URL (ID match failed or no ID field)
    if (downloadUrl === null) {
      for (const doc of docs) {
        const url = extractUrl(doc);
        if (url !== null) {
          downloadUrl = url;
          matchedDoc = doc;
          console.error(
            `[bamboohr] downloadPdf: no document matched fileId=${fileId}; using first document with a URL (applicationId=${applicationId}).`,
          );
          break;
        }
      }
    }

    if (downloadUrl === null) {
      console.error(
        `[bamboohr] downloadPdf: documents list returned ${docs.length} document(s) but none had a usable URL field.`,
      );
      console.error(
        `[bamboohr] downloadPdf: document shapes (first 3): ${JSON.stringify(docs.slice(0, 3))}`,
      );
      console.error(
        `[bamboohr] downloadPdf: full raw response: ${JSON.stringify(docsRaw)}`,
      );
      console.error(
        `[bamboohr] Expected one of these URL fields: url, downloadUrl, download_url, original, href, link, fileUrl, file_url`,
      );
      throw new Error(
        `BambooHR PDF download: could not find a download URL in documents list ` +
        `(applicationId=${applicationId}). Check stderr for document shapes and add the ` +
        `correct field name to the extractUrl helper in client.ts.`,
      );
    }

    void matchedDoc; // used only for debug logging above; suppress unused-var lint

    // --- Step 2: Download the binary PDF ---
    // The URL from the documents list may be absolute (https://...) or a relative path.
    const absoluteUrl = downloadUrl.startsWith('http')
      ? downloadUrl
      : `${this.baseUrl}${downloadUrl.startsWith('/') ? '' : '/'}${downloadUrl}`;

    const res = await fetch(absoluteUrl, {
      headers: {
        Authorization: this.authHeader,
        // NO Accept: application/json — binary response
      },
    });

    if (!res.ok) {
      console.error(
        `[bamboohr] downloadPdf: binary download returned HTTP ${res.status} for URL=${absoluteUrl} ` +
        `(applicationId=${applicationId}, fileId=${fileId})`,
      );
      throw new Error(
        `BambooHR PDF download error: HTTP ${res.status} ${res.statusText} ` +
        `(applicationId=${applicationId}, fileId=${fileId}, url=${absoluteUrl})`,
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
