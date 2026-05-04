# v1.1 Research Synthesis — Multi-Job & AWS Deployment

**Synthesized:** 2026-05-04
**Sources:** STACK.md, FEATURES.md, ARCHITECTURE.md, PITFALLS.md

---

## 1. Stack Additions

| Addition | Decision | Rationale |
|----------|----------|-----------|
| Terraform (AWS provider ~> 6.0) | New — `terraform/` directory | IaC for reproducible provisioning; v6 is current major, v5 in patch-only mode |
| AWS ECR (private) | Docker registry | IAM instance profile auth — no stored credentials; in-region pulls are free |
| AWS EC2 t4g.micro / Amazon Linux 2023 | Cron host | ~$6/month; burstable CPU ideal for short daily runs; ARM64 fully supported by Node/Alpine |
| AWS SSM Parameter Store (SecureString) | Secrets storage | Free standard tier; encrypts at rest; no `.env` on disk; no Secrets Manager cost for static keys |
| `scripts/deploy.sh` (bash) | Deploy automation | `docker build + push to ECR + ssm send-command`; no CI/CD platform dependency |
| No new Node.js packages | Multi-job support | Pure schema + wiring refactor; `js-yaml` + `zod` already handle it |

---

## 2. Feature Decisions

**Multi-job config:** Single `config.yaml` with a `jobs:` array (not separate files per job). Each job entry is fully self-contained with its own `openingId`, `stages`, `hardRules`, `fieldMap`, and `softRules`. YAML anchors handle shared field maps within the file. Parallel job processing is ruled out — sequential processing avoids BambooHR rate-limit stacking and keeps logs readable.

**Schema migration:** Breaking change from `job:` (single object) to `jobs:` (array). Use expand-then-contract: accept both old `job:` key and new `jobs:` array in the loader; normalize to array internally. Fail fast on startup if any job entry fails Zod validation.

**AWS deployment:** EC2 + crontab over ECS Fargate or EventBridge. Mirrors the local setup exactly; Terraform surface is 8 resources vs. 15+ for ECS. No CodeDeploy, no GitHub Actions CI — `deploy.sh` is sufficient for a single-operator internal tool.

**Secrets:** SSM Parameter Store (not Secrets Manager — $0.40/secret/month is unnecessary for static keys that don't rotate). `config.yaml` delivered via SSM Parameter Store value at cron time (8KB limit is sufficient), written to a temp file with `trap` cleanup — never persists on disk.

**Deferred:** Instance auto-start/stop scheduler, GitHub Actions CI/CD, ECS Fargate migration, S3-backed `config.yaml` delivery (acceptable for v1.1; needed if config exceeds 8KB or update frequency increases).

---

## 3. Architecture Changes

**Codebase changes (TypeScript only):**
- `src/config/schema.ts` — extract `jobConfigSchema`; root `configSchema` becomes `z.object({ jobs: z.array(jobConfigSchema).min(1) })`
- `src/pipeline/candidate-processor.ts` — type change: `Config` → `JobConfig` (no logic changes)
- `src/screener/screening-pipeline.ts` — add outer `for...of config.jobs` loop; extract `runJob(jobConfig)`; call `validateStages(jobConfig)` inside the per-job block (not once globally); add per-job try/catch and per-job summary log line
- `src/index.ts` — unchanged if outer loop lives in `ScreeningPipeline`

**New infrastructure:**
```
terraform/
  main.tf          — ECR repo, IAM role + instance profile, security group, EC2 instance
  variables.tf     — aws_region, cron_schedule
  outputs.tf       — ecr_repository_url, instance_id
  user_data.sh.tpl — installs Docker, writes run.sh, installs crontab

scripts/
  deploy.sh        — build → tag (:latest + :sha) → ECR push → optional ssm send-command
```

**EC2 cron flow at runtime:** `run.sh` → ECR auth (fresh token every invocation) → `docker pull :latest` → fetch secrets from SSM → write config to temp file → `docker run --rm -e ... -v config:/app/config.yaml:ro` → temp file deleted via `trap`.

**Phase build order:** Phase 6 (TypeScript multi-job, no AWS dependency) → Phase 7 (Terraform provisioning) → Phase 8 (deploy scripts + cron verification). Phases 6 and 7 can be planned in parallel but Phase 7 execution depends on Phase 6 producing a stable image.

---

## 4. Watch Out For

**MJ-04 — Wrong stage map applied across jobs (CRITICAL):** If `validateStages()` is called once before the job loop, Job 1's stage IDs are used for all subsequent jobs. BambooHR returns HTTP 200 for a valid-but-wrong stage ID — corrupt ATS state with no error. Fix: call `validateStages(jobConfig)` inside the per-job loop.

**TF-02 — Secrets in Terraform state (CRITICAL):** Any API key interpolated into `user_data` via a Terraform variable is stored in the state file in plaintext. Fix: never put secret values in Terraform variables; fetch from SSM at runtime in the cron script.

**TF-04 — ECR token expires after 12 hours (HIGH):** A one-time `docker login` at deploy time leaves a cached token that expires before the next cron run. Fix: install `amazon-ecr-credential-helper` in `user_data`, or run `aws ecr get-login-password | docker login` at the top of every cron invocation.

**MJ-02 — No job-level error isolation (HIGH):** Without a per-job try/catch in the outer loop, one job's `StageValidationError` aborts all remaining jobs. Fix: wrap each job iteration in try/catch, log `{ outcome: 'job_error', jobId, reason }`, and continue.

**TF-01 — `user_data` runs only on first boot (MEDIUM):** Terraform `apply` after changing `user_data` shows "update in-place" but the EC2 instance runs the old script. Fix: set `user_data_replace_on_change = true` from day one so any change triggers a predictable instance replacement.

---

## 5. Open Questions

1. **ARM64 vs x86:** STACK.md recommends t4g.micro (ARM64) but ARCHITECTURE.md uses `t3.micro` (x86). Decide before writing Terraform — this affects the `aws_ami` filter and the `docker buildx --platform` flag in `deploy.sh`.

2. **Secrets backend:** STACK.md recommends SSM Parameter Store (free, 3 separate params). ARCHITECTURE.md recommends Secrets Manager ($0.40/month, 1 JSON document). Pick one before writing Terraform — affects IAM policy actions and the cron script.

3. **`config.yaml` delivery:** SSM Parameter Store (8KB limit, no extra AWS service) vs S3 (no size limit, one extra resource). Confirm multi-job config stays under 8KB or choose S3.

4. **Lock file / idempotency guard (MJ-05):** Deferred from v1.0. With multi-job, runs take longer and cron overlap becomes more likely. Decide whether to include in Phase 6 or defer again.

5. **Terraform state backend:** Local state is acceptable for a single developer. If a second operator joins before v1.2, S3 + DynamoDB locking is needed. Decide before first `terraform apply`.

---

*Confidence: HIGH for TypeScript refactor (code in hand). HIGH for AWS patterns (official docs verified). MEDIUM for specific Terraform resource syntax (verified against registry docs but not executed). Flag BambooHR-specific API claims against live docs before shipping.*
