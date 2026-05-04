# Feature Landscape — v1.1: Multi-Job & AWS Deployment

**Domain:** Automated HR candidate screening agent (internal tool, BambooHR + LLM)
**Researched:** 2026-05-04
**Confidence:** HIGH (existing codebase inspected; AWS patterns verified via official docs and multiple sources)

---

## Capability Area 1: Multi-Job Config Structure

### Context

The v1.0 config schema has a single top-level `job:` key with `openingId`, `stages`, `hardRules`, `fieldMap`, and `softRules`. The Zod schema (`src/config/schema.ts`) and `ScreeningPipeline` are both typed to a single `Config` object. The `index.ts` entry point calls `loadConfig(configPath)` once and builds one `ScreeningPipeline`.

Multi-job support means N job openings can be screened per container run, each with its own rules, stages, pass/fail criteria, and field mapping.

### Config Shape Decision: jobs array in a single file (recommended)

A single `config.yaml` with a top-level `jobs:` array is the correct pattern for this codebase. Rationale:

- The existing volume mount is `-v config.yaml:/app/config.yaml`. Adding jobs is additive (extend the array), not structural (no new mount points needed).
- YAML anchors (`&anchor` / `*ref`) work within a single file; they do not work across multiple files. Common cross-job config (shared `fieldMap`, shared `hardRules`) can be shared via YAML anchors in a single file.
- A `jobs/job-a.yaml` + `jobs/job-b.yaml` pattern requires either directory-mounting or a glob-load mechanism. This adds complexity to the Docker command and the config loader.
- The Zod schema extension is straightforward: replace `configSchema` with a wrapper `z.object({ jobs: z.array(jobConfigSchema).min(1) })`.
- The `ScreeningPipeline` already processes one `Config` job; the entry point loops over `config.jobs` and runs a pipeline per job sequentially (consistent with the existing sequential-processing constraint from v1.0).

### Table Stakes (Multi-Job Config)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `jobs:` array at config root, each job has `openingId` + `stages` + `hardRules` + `fieldMap` + `softRules` | Without this, the whole point of multi-job support is not met | LOW | Extend `configSchema` to wrap `jobConfigSchema` in `z.array().min(1)`; backward compat: provide a migration note in config.yaml.example |
| Sequential job processing — one job fully completes before the next starts | Keeps per-candidate error isolation intact; avoids BambooHR rate-limit stacking | LOW | Outer `for...of` in `main()` or a new `MultiJobPipeline`; `ScreeningPipeline.run()` is already sequential |
| Per-job summary log line | When N jobs run in one container invocation, operators must see per-job outcomes without parsing the full log | LOW | Emit a summary JSON line after each job run with `{ job: openingId, processed, pass, fail, needsReview, errors }` |
| Total-run summary JSON at container exit | Existing INFRA-03 requirement; must aggregate across all jobs | LOW | Accumulate counters across all job runs; emit single final `{ totalProcessed, totalPass, ... }` on stdout |
| Config load + schema validation catches per-job errors at startup | A misconfigured job 3 must not be discovered after jobs 1 and 2 have already run | LOW | Validate the full `jobs` array at startup via Zod before any BambooHR call; fail fast with the job index and field name |
| Job name/label field (optional) in config for log readability | Log lines for job `12345` are harder to read than `Senior Engineer - Barcelona` | LOW | Optional `name:` field on each job config; default to `openingId` in log output |

### Differentiators (Multi-Job Config)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| YAML anchors for shared field maps | When multiple job openings at the same company share BambooHR form structure, the `fieldMap` is identical — no copy-paste | LOW | Leverage YAML anchor/alias natively; document the pattern in config.yaml.example; no code changes needed |
| `enabled: false` per-job flag | Quickly disable one job without deleting its config | LOW | Add `enabled: z.boolean().optional().default(true)` to `jobConfigSchema`; skip disabled jobs in the loop |
| Dry-run applies independently per job | Existing `LIVE_MODE=true` global flag still controls writes; no per-job dry-run override needed (YAGNI) | N/A | No change needed; document that `LIVE_MODE=true` enables writes for ALL jobs |

### Anti-Features (Multi-Job Config)

| Feature | Why Requested | Why Wrong | What to Do Instead |
|---------|---------------|-----------|-------------------|
| One YAML file per job, directory mount | Seems more modular | Requires glob loading, no YAML anchor sharing, complicates Docker volume mount | Use `jobs:` array in one file; YAML anchors handle shared config |
| Job-level `LIVE_MODE` env var override | Seems flexible | Global `LIVE_MODE` is intentionally binary to prevent partial live/dry confusion | Single `LIVE_MODE=true` controls all jobs; document clearly |
| Parallel job processing (Promise.all) | Seems faster | BambooHR rate limits apply across all API calls regardless of which job they serve; parallel processing can trigger 429s and makes logs harder to follow | Sequential is correct; runs are short-lived (N jobs × M candidates); speed is not a constraint |
| Database of job configs | Seems more dynamic | Internal tool; YAML config mounted into container is the established pattern; adds an unnecessary persistence layer | Keep YAML; add jobs to the array |

### Feature Dependencies (Multi-Job)

```
[Extended configSchema: z.array(jobConfigSchema)]
    └──required by──> [Multi-job entry point loop]
    └──required by──> [Per-job summary logging]

[Multi-job entry point loop]
    └──wraps──> [ScreeningPipeline.run()] (one call per job, no changes to pipeline)
    └──feeds──> [Total-run summary JSON]

[Per-job summary logging]
    └──requires──> [Job name/label field in config]
```

---

## Capability Area 2: AWS Infrastructure (Table Stakes vs Differentiators)

### Context

The goal is EC2 + Docker + cron on AWS, provisioned via Terraform, with no manual SSH required for either initial provisioning or image updates. The existing `install.sh` handles local setup (docker build + crontab). On AWS, these responsibilities shift to Terraform (provision) and a deploy script (update).

### Required AWS Resources (Terraform)

The minimum viable set for a single-instance, cron-triggered Docker workload:

| Resource | Purpose | Notes |
|----------|---------|-------|
| `aws_ecr_repository` | Store built Docker images | Private registry; image tag `latest` + commit SHA tag |
| `aws_iam_role` + `aws_iam_instance_profile` | Let EC2 pull from ECR and receive SSM commands | Trust policy: `ec2.amazonaws.com`; attached policies: `AmazonSSMManagedInstanceCore` + ECR read-only |
| `aws_instance` (t3.micro or t3.small) | Run the container | `user_data` bootstraps Docker + SSM agent + cron; Amazon Linux 2023 AMI recommended (Docker available via dnf; SSM agent pre-installed) |
| `aws_security_group` | Minimal egress (HTTPS for ECR, BambooHR, OpenAI) | No inbound ports required — SSM uses outbound HTTPS to `ssm.<region>.amazonaws.com`; no SSH port needed |
| `aws_ssm_parameter` (one per secret) | Store `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY` as SecureString | IAM role grants `ssm:GetParameters` on these specific ARNs |
| S3 bucket (optional, or config in SSM Parameter) | Store `config.yaml`; EC2 pulls at cron time | Alternative: mount config via SSM Parameter Store value if it fits within the 8KB limit; S3 is cleaner for YAML files of real size |

### Table Stakes (AWS Deployment)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Terraform provisions all resources in one `terraform apply` | Without IaC, setup is manual and unreproducible | MEDIUM | One `main.tf` covering ECR repo, IAM role, instance profile, security group, EC2 instance, SSM parameters (values left as `""` — filled post-apply by operator) |
| EC2 `user_data` bootstrap script installs Docker + configures cron | Without this, the instance can't run the container at cron time | LOW | `user_data.sh`: `dnf update -y`, `dnf install docker -y`, `systemctl enable --now docker`, write cron script to `/etc/cron.d/screener`, add ec2-user to docker group |
| Cron script on EC2 fetches secrets from SSM and runs `docker run` | No `.env` file on disk (credentials in SSM); container invoked with `-e` flags populated from SSM at runtime | LOW | `/usr/local/bin/run-screener.sh`: call `aws ssm get-parameter` for each secret → populate env vars → `docker run --rm -e KEY=val ... IMAGE` |
| ECR login before `docker pull` in cron script | `docker pull` from ECR requires fresh auth token (12-hour TTL) | LOW | `aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ECR_URL` at start of cron script |
| Config file (`config.yaml`) accessible to container at runtime | Container needs rules to evaluate candidates | LOW | Two options: (1) store config in SSM Parameter Store (cleanest; no S3 dependency; 8KB limit is sufficient for a multi-job YAML), write to temp file in cron script, mount into container; (2) S3 object sync at cron time. Use SSM Parameter Store for simplicity. |
| No open inbound ports — SSH not required | Security requirement; SSM Session Manager provides shell access without exposing port 22 | LOW | Security group: egress only (443 HTTPS); no ingress rules; `AmazonSSMManagedInstanceCore` policy on instance role enables SSM |
| `deploy.sh` script: build → tag → push to ECR | Operators need a repeatable way to push new image versions | LOW | Script: `docker build -t $IMAGE .`, `docker tag $IMAGE $ECR_URL:latest`, `aws ecr get-login-password | docker login ...`, `docker push $ECR_URL:latest` |
| `deploy.sh` script: trigger EC2 image update via SSM Run Command | After pushing a new image, EC2 must pull and use it at next cron run — or immediately | LOW | `aws ssm send-command --document-name AWS-RunShellScript --parameters 'commands=["docker pull $ECR_URL:latest"]' --targets "Key=tag:Name,Values=$INSTANCE_NAME"` |

### Differentiators (AWS Deployment)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Terraform `output` for ECR URL and instance ID | Deploy script can read ECR URL and instance ID from `terraform output` rather than hardcoding | LOW | `output "ecr_repository_url" {}` and `output "instance_id" {}`; deploy script reads with `terraform output -raw ecr_repository_url` |
| Image tag with git SHA alongside `latest` | Enables rollback — `latest` is always current, but SHA-tagged images preserve history | LOW | `deploy.sh` reads `git rev-parse --short HEAD` as IMAGE_TAG; pushes both `:latest` and `:$SHA` |
| `LIVE_MODE` stored in SSM Parameter Store, not hardcoded | Enabling/disabling live writes without touching Terraform or deploy script | LOW | `aws ssm put-parameter --name /screener/live_mode --value true --overwrite`; cron script reads it at runtime |
| Terraform `variable "aws_region"` with a default | One-line change to deploy to a different region | LOW | Add `variable "aws_region" { default = "eu-west-1" }` and pass to all `aws_*` resources |
| Instance scheduler (start/stop cron via AWS Instance Scheduler or EventBridge) | t3.micro costs ~$8/month running 24/7; stopping it outside the daily screening window cuts costs significantly | MEDIUM | EventBridge Scheduler can start instance 5 min before cron, stop it after. Adds complexity. Only worth it if cost is a concern. |

### Anti-Features (AWS Deployment)

| Feature | Why Requested | Why Wrong | What to Do Instead |
|---------|---------------|-----------|-------------------|
| ECS Fargate + EventBridge Scheduler instead of EC2 + crontab | Serverless; no instance to manage; closer to "best practice" for cron containers | Higher complexity for the first AWS deployment; Terraform surface is larger (ECS cluster, task definition, EventBridge rule, Fargate networking); no advantage for a single daily run of a short-lived container | EC2 + crontab is simpler, mirrors the existing local setup exactly, and costs the same or less for a single daily task |
| CodeDeploy or CodePipeline | Full CI/CD pipeline | 4-5 additional AWS services (CodeBuild, CodePipeline, CodeDeploy); significant Terraform complexity; deployment happens via a local `deploy.sh` script which is sufficient for an internal tool | `deploy.sh` calling `docker build` + `ecr push` + `ssm send-command` covers the full deploy cycle with zero additional AWS services |
| Hardcoded secrets in Terraform `vars` or EC2 user_data | Simpler at first glance | Secrets stored in state file; visible in AWS console; violates least-privilege and GDPR requirements | SSM Parameter Store SecureString; values populated by operator after `terraform apply`; never in `.tf` files or state in plaintext |
| IAM user with access keys on the EC2 instance | Seems like straightforward credentials management | IAM roles with instance profiles are the AWS-recommended approach; access keys on instances are a well-documented security anti-pattern (key rotation, key leakage risk) | IAM instance profile with least-privilege policies |
| Docker Compose on EC2 | Seems convenient for multi-container setup | No multi-container setup needed; single Docker run command is sufficient; adds unnecessary complexity | Plain `docker run` in cron script |
| Store `.env` file on EC2 disk | Mirrors local setup | Credentials on disk persist through reboots, AMI snapshots, and EBS snapshots — GDPR exposure | Fetch secrets from SSM at runtime in cron script; never write to disk |

### Feature Dependencies (AWS Infrastructure)

```
[ECR repository]
    └──required by──> [deploy.sh push step]
    └──required by──> [EC2 cron pull step]

[IAM role + instance profile]
    └──required by──> [EC2 instance] (attached at launch)
    └──enables──> [ECR pull without credentials on disk]
    └──enables──> [SSM Run Command reception]
    └──enables──> [SSM Parameter Store reads at runtime]

[SSM Parameter Store (secrets + config)]
    └──required by──> [cron script] (fetches secrets at invocation time)
    └──enables──> [no .env file on disk]

[EC2 instance with user_data]
    └──requires──> [IAM role + instance profile]
    └──requires──> [security group]
    └──bootstraps──> [Docker + cron script at first boot]

[Security group (egress-only)]
    └──required by──> [EC2 instance]
    └──allows──> [ECR pull (HTTPS 443), BambooHR API, OpenAI API]
    └──blocks──> [all inbound — no SSH, no HTTP]

[deploy.sh]
    └──requires──> [ECR repository URL from terraform output]
    └──requires──> [instance ID or tag from terraform output]
    └──performs──> [docker build + tag + push to ECR]
    └──performs──> [aws ssm send-command to trigger docker pull on EC2]
```

---

## Capability Area 3: No-Manual-SSH Deploy Flow

### Recommended Pattern: deploy.sh (local) + SSM Run Command (remote pull)

The deploy flow has two phases that a single `deploy.sh` script orchestrates from the developer's machine:

**Phase A — Build and push (local machine):**
1. `docker build -t $IMAGE_NAME .` — build from project root
2. `docker tag $IMAGE_NAME $ECR_URL:latest` and `$ECR_URL:$GIT_SHA`
3. `aws ecr get-login-password | docker login --username AWS --password-stdin $ECR_URL`
4. `docker push $ECR_URL:latest` and `docker push $ECR_URL:$GIT_SHA`

**Phase B — Trigger EC2 pull (via SSM, no SSH):**
5. `aws ssm send-command --document-name AWS-RunShellScript --parameters 'commands=["docker pull $ECR_URL:latest"]' --targets "Key=tag:Name,Values=bamboohr-screener" --region $REGION`

The cron script on EC2 already references `:latest` tag, so the next cron execution picks up the new image automatically. Step 5 is an optional pre-pull to ensure the image is cached before the next run. Alternatively, omit step 5 entirely — the cron script runs `docker pull` at invocation time anyway (see cron script design below).

### Cron Script on EC2 (`/usr/local/bin/run-screener.sh`)

The script the EC2 crontab calls at the scheduled time:

```bash
#!/usr/bin/env bash
set -euo pipefail

REGION="eu-west-1"                     # Set by Terraform user_data at provision time
ECR_URL="123456789.dkr.ecr.eu-west-1.amazonaws.com/bamboohr-screener"
SSM_PREFIX="/screener"

# 1. Authenticate Docker to ECR (token valid 12 hours; safe to run at each invocation)
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin "$ECR_URL"

# 2. Pull latest image
docker pull "$ECR_URL:latest"

# 3. Fetch secrets from SSM Parameter Store
BAMBOOHR_API_KEY=$(aws ssm get-parameter --region "$REGION" \
  --name "$SSM_PREFIX/bamboohr_api_key" --with-decryption \
  --query Parameter.Value --output text)
BAMBOOHR_SUBDOMAIN=$(aws ssm get-parameter --region "$REGION" \
  --name "$SSM_PREFIX/bamboohr_subdomain" --with-decryption \
  --query Parameter.Value --output text)
OPENAI_API_KEY=$(aws ssm get-parameter --region "$REGION" \
  --name "$SSM_PREFIX/openai_api_key" --with-decryption \
  --query Parameter.Value --output text)
LIVE_MODE=$(aws ssm get-parameter --region "$REGION" \
  --name "$SSM_PREFIX/live_mode" \
  --query Parameter.Value --output text 2>/dev/null || echo "false")

# 4. Write config.yaml from SSM Parameter Store to temp file
CONFIG=$(aws ssm get-parameter --region "$REGION" \
  --name "$SSM_PREFIX/config_yaml" \
  --query Parameter.Value --output text)
CONFIG_PATH=$(mktemp /tmp/screener-config-XXXXXX.yaml)
echo "$CONFIG" > "$CONFIG_PATH"
trap "rm -f $CONFIG_PATH" EXIT

# 5. Run container — exits after processing (short-lived pattern preserved)
docker run --rm \
  -e BAMBOOHR_API_KEY="$BAMBOOHR_API_KEY" \
  -e BAMBOOHR_SUBDOMAIN="$BAMBOOHR_SUBDOMAIN" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e LIVE_MODE="$LIVE_MODE" \
  -v "$CONFIG_PATH:/app/config.yaml:ro" \
  "$ECR_URL:latest"
```

Key design decisions in this script:
- Secrets never touch disk (only env vars into the container).
- `config.yaml` written to a temp file with `trap` cleanup — exists on disk for the duration of the `docker run` call only.
- ECR auth runs at every invocation (not cached) — avoids stale 12-hour token expiry failures on infrequently-run cron jobs.
- `LIVE_MODE` read from SSM at runtime — operator can flip it without any deployment.

### Table Stakes (Deploy Flow)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `deploy.sh` builds, tags (`:latest` + `:sha`), and pushes to ECR | Single command to ship a new version | LOW | Reads ECR URL from `terraform output -raw ecr_repository_url` to avoid hardcoding |
| `deploy.sh` sends SSM Run Command to pre-pull image on EC2 | Ensures EC2 has the image cached before next cron run | LOW | `aws ssm send-command` with `AWS-RunShellScript`; targets by instance tag `Name=bamboohr-screener` |
| Cron script on EC2 reads secrets from SSM at invocation time | No credentials on disk | LOW | `aws ssm get-parameter --with-decryption` for each secret |
| Cron script on EC2 reads `config.yaml` from SSM Parameter Store | No config file on disk between runs | LOW | SSM Parameter Store value limit is 8KB; sufficient for a multi-job YAML config |
| `README` or `docs/deploy.md` documents the initial setup sequence | Without docs, the Terraform + deploy.sh sequence is opaque | LOW | Document: `terraform apply` → `aws ssm put-parameter` for each secret → `deploy.sh` → verify with dry-run cron trigger |

### Differentiators (Deploy Flow)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| `deploy.sh --dry-run` flag that builds and pushes but skips the SSM trigger | Useful for validating the image builds and pushes cleanly without affecting the running instance | LOW | `if [[ "$1" == "--dry-run" ]]; then exit 0; fi` before the SSM send-command step |
| SSM Run Command waits for completion and prints output | Confirms the pull succeeded rather than fire-and-forget | LOW | Add `--wait` to `aws ssm send-command` or poll with `aws ssm get-command-invocation` |
| Terraform `null_resource` + `local-exec` for post-apply SSM param population prompt | Reminds operator to fill in secrets after `terraform apply` | LOW | Use `null_resource` with a `local-exec` that prints instructions; not actual secret injection |

### Anti-Features (Deploy Flow)

| Feature | Why Requested | Why Wrong | What to Do Instead |
|---------|---------------|-----------|-------------------|
| Store `config.yaml` on EC2 EBS volume permanently | Seems simpler than SSM | Config changes require SSH or a separate automation to update the file; EBS snapshots persist the config; SSM Parameter Store version history is better suited for config management | Store config in SSM Parameter Store; write to temp file at cron time |
| GitHub Actions CI/CD that auto-deploys on push to main | Seems like "best practice" | Adds GitHub OIDC + IAM role federation complexity; for an internal tool deployed by one person, `deploy.sh` is faster and sufficient | `deploy.sh` run locally; add CI/CD only when team grows |
| EventBridge → SSM Automation to auto-pull on ECR push | Seems elegant | Adds an EventBridge rule, IAM permission for EventBridge to call SSM, and asynchronous coordination complexity; the cron script already pulls at invocation time | Cron script runs `docker pull` at invocation — the next cron run always uses the latest image |

---

## MVP Definition for v1.1

### Phase A — Multi-Job Config (must ship together)
- [ ] Extend `configSchema`: add `jobs: z.array(jobConfigSchema).min(1)` with backward-compat migration
- [ ] Update `config.yaml.example` with two-job example using YAML anchors for shared `fieldMap`
- [ ] Update entry point (`index.ts`): loop over `config.jobs`, run `ScreeningPipeline` per job sequentially
- [ ] Per-job summary JSON log line; updated total-run summary aggregating all jobs
- [ ] `enabled: false` per-job skip flag

### Phase B — AWS Terraform Provisioning (must ship together)
- [ ] `terraform/main.tf`: ECR repo, IAM role + instance profile, security group (egress only), EC2 instance
- [ ] `terraform/user_data.sh`: install Docker, write cron entry, install cron script
- [ ] SSM Parameter Store parameters declared as `aws_ssm_parameter` resources with placeholder values
- [ ] `terraform output` for ECR URL, instance ID, instance name tag

### Phase C — Deploy Scripts (must ship together; depends on Phase B)
- [ ] `scripts/deploy.sh`: build → tag (`:latest` + `:sha`) → ECR push → SSM Run Command pull trigger
- [ ] EC2 cron script (`/usr/local/bin/run-screener.sh`): ECR auth → pull → SSM secret fetch → docker run
- [ ] `docs/deploy.md` or `README` section: end-to-end first-deploy and update sequences

### Defer
- Instance auto-start/stop scheduling (EventBridge + Instance Scheduler) — only worth it if cost is a concern
- GitHub Actions CI/CD — add when more than one person deploys
- ECS Fargate migration — add if EC2 management becomes a burden (unlikely for one daily task)

---

## Sources

- AWS SSM Run Command (no-SSH EC2 management): [AWS Systems Manager Run Command docs](https://docs.aws.amazon.com/systems-manager/latest/userguide/walkthrough-cli.html) — HIGH confidence (official)
- EC2 + Docker + Terraform pattern: [Deploy an EC2 to run Docker with Terraform — Andrew Klotz](https://klotzandrew.com/blog/deploy-an-ec2-to-run-docker-with-terraform/) — MEDIUM confidence (verified against official AWS docs)
- ECR image push and pull authentication: [Amazon ECR User Guide — push image](https://docs.aws.amazon.com/AmazonECR/latest/userguide/docker-push-ecr-image.html) — HIGH confidence (official)
- SSM Parameter Store for secrets injection into Docker: [GitHub — aws-ssm-env](https://github.com/jamietsao/aws-ssm-env), [GitHub — telia-oss/aws-env](https://github.com/telia-oss/aws-env) — MEDIUM confidence (verified against AWS docs pattern)
- EventBridge Scheduler for cron containers on ECS (considered, rejected): [AWS blog — Migrate cron jobs to ECS + EventBridge](https://aws.amazon.com/blogs/containers/migrate-cron-jobs-to-event-driven-architectures-using-amazon-elastic-container-service-and-amazon-eventbridge/) — HIGH confidence (official; rejected because EC2+cron is simpler for this use case)
- IAM instance profile + AmazonSSMManagedInstanceCore for no-SSH: [Terraform Registry — aws_iam_instance_profile](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/iam_instance_profile) — HIGH confidence (official)
- YAML single-file jobs array vs separate files tradeoffs: CI/CD system patterns (GitHub Discussions, GitLab docs, Azure DevOps docs) — HIGH confidence (pattern is well-established; YAML anchor limitation confirmed by multiple sources)
- Existing codebase (inspected directly): `src/config/schema.ts`, `src/screener/screening-pipeline.ts`, `src/index.ts`, `config.yaml.example`, `install.sh` — HIGH confidence

---

*Feature research for: BambooHR candidate screener agent — v1.1 Multi-Job & AWS Deployment*
*Researched: 2026-05-04*
