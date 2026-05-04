# Architecture Patterns — v1.1: Multi-Job & AWS Deployment

**Domain:** Automated HR candidate screening agent (TypeScript, OpenAI Agents SDK, BambooHR)
**Researched:** 2026-05-04
**Confidence:** HIGH for config schema changes and pipeline wiring (code is in hand); MEDIUM for Terraform resource list and secrets injection pattern (verified against Terraform Registry docs and AWS documentation via web search)

---

## Context: What Exists vs. What Changes

This document supersedes the v1.0 architecture research. The v1.0 system is fully built and
human-UAT verified. The new milestone adds two features without rewriting the core:

| Component | v1.0 State | v1.1 Change |
|-----------|-----------|------------|
| `src/config/schema.ts` | Single `job` object | Needs to support `jobs` array |
| `src/screener/screening-pipeline.ts` | Handles one job | Needs outer loop over jobs |
| `src/index.ts` | Constructs one `CandidateProcessor` for the config | Needs to construct one per job, or pass job-scoped config |
| `src/pipeline/candidate-processor.ts` | Receives `Config` — reads `config.job.*` directly | Unchanged if job is passed in as a scoped sub-config |
| `Dockerfile` | Reads `--env-file` at `docker run` | Unchanged — secrets injection moves to the cron wrapper script on EC2 |
| `crontab` (local) | `docker run --rm --env-file /etc/screener.env` | Replaced on EC2 by a wrapper script that fetches from Secrets Manager |
| Terraform | Does not exist | New: ECR repo, EC2 instance, IAM role/instance profile, security group, cron wiring |
| Deploy scripts | Does not exist | New: `build.sh`, `push.sh`, `deploy.sh` (or a single `release.sh`) |

---

## Part 1: Multi-Job Config Schema Changes

### Current Schema Shape

```
config.yaml
  job:
    openingId: "123"
    stages: { intake, pass, fail }
  hardRules: { ... }
  fieldMap: { ... }
  softRules: { ... }
```

`configSchema` in `src/config/schema.ts` is a single `z.object` where `job` is a single object,
and `hardRules`, `fieldMap`, `softRules` are siblings of `job` at the top level.

### Recommended Schema Change

Wrap the current single-job block into a `jobs` array. Each element is one job with its own
`openingId`, `stages`, `hardRules`, `fieldMap`, and `softRules`. This is a breaking change to
the YAML format.

```typescript
// New per-job sub-schema (extracts everything currently at root)
const jobConfigSchema = z.object({
  openingId: z.string().min(1).refine(
    (v) => !v.startsWith('REPLACE_WITH'),
    { message: 'openingId must be set to a real BambooHR job opening ID' }
  ),
  stages: z.object({
    intake: z.string().min(1),
    pass: z.string().min(1),
    fail: z.string().min(1),
  }),
  hardRules: hardRulesSchema,   // same schema as current `hardRules`
  fieldMap: z.record(z.string(), z.string()),
  softRules: softRulesSchema,   // same schema as current `softRules`
});

// New top-level config
export const configSchema = z.object({
  jobs: z.array(jobConfigSchema).min(1, {
    message: 'config must define at least one job',
  }),
});

export type JobConfig = z.infer<typeof jobConfigSchema>;
export type Config = z.infer<typeof configSchema>;
```

**Why this shape:** Each job is fully self-contained. There is no shared `fieldMap` or shared
`hardRules` across jobs — jobs are for different openings, each with different criteria. Sharing
rules across jobs would create implicit coupling that breaks the moment two jobs need different
salary ceilings or different required fields.

**Backward compatibility:** This is a breaking YAML change. The existing `config.yaml` must be
migrated. Migration is straightforward — wrap the current top-level keys inside a `jobs:` array
element. The phase plan should include a migration note and an updated `config.example.yaml`.

### Example Multi-Job config.yaml

```yaml
jobs:
  - openingId: "456"
    stages:
      intake: "New"
      pass: "Schedule Phone Screen"
      fail: "Reviewed"
    hardRules:
      maxSalary:
        value: 90000
        label: "Salary ceiling €90k"
      requiredFields:
        fields: ["resume"]
        label: "CV required"
    fieldMap:
      salary: "customField_12345"
    softRules:
      required:
        - label: "Node.js experience"
          description: "Candidate demonstrates Node.js backend experience"

  - openingId: "789"
    stages:
      intake: "Applied"
      pass: "Phone Screen"
      fail: "Not Qualified"
    hardRules:
      requiredBoolean:
        - field: "workAuthorization"
          expectedValue: true
          label: "EU work authorization required"
    fieldMap:
      workAuthorization: "customField_99999"
    softRules:
      required:
        - label: "React experience"
          description: "Candidate has production React experience"
```

---

## Part 2: ScreeningPipeline Changes for Multi-Job

### What Changes

`ScreeningPipeline` currently receives a single `Config` and processes one job. With multi-job
support, `ScreeningPipeline` needs to iterate over `config.jobs` and run the full pipeline for
each job.

There are two valid designs:

**Option A: Outer loop in ScreeningPipeline.run() (RECOMMENDED)**

`ScreeningPipeline` receives the full `Config` (now containing `config.jobs: JobConfig[]`). Its
`run()` method loops over `config.jobs` and runs the job-scoped pipeline for each. The
`CandidateProcessor` receives a `JobConfig` instead of `Config` so it only sees its own job's
rules and stages.

```typescript
// src/screener/screening-pipeline.ts — new run() outline

async run(): Promise<void> {
  for (const jobConfig of this.config.jobs) {
    console.error(`[main] Processing job: ${jobConfig.openingId}`);
    await this.runJob(jobConfig);
  }
}

private async runJob(jobConfig: JobConfig): Promise<void> {
  // validateStages, fetchCandidates, per-candidate loop
  // — identical to current run() but scoped to jobConfig
}
```

**Option B: Run ScreeningPipeline once per job (caller loops)**

`index.ts` loops over `config.jobs` and creates one `ScreeningPipeline` per job. This works but
requires constructing a new `CandidateProcessor` per job in `index.ts`, making the wiring more
complex with no benefit.

**Why Option A is recommended:** The existing `ScreeningPipeline` constructor already owns the
per-job loop. Moving the loop outward keeps `index.ts` thin and prevents it from needing to know
about job iteration. The `CandidateProcessor` stays unchanged if it receives `JobConfig` (the
per-job sub-config) instead of the full `Config`.

### CandidateProcessor Type Change

`CandidateProcessor` currently receives `Config` (the top-level type). Under the new schema,
`Config` no longer has `job`, `hardRules`, `fieldMap`, `softRules` at the top level — those
move into each `JobConfig`. The cleanest change is:

- Replace `Config` with `JobConfig` in `CandidateProcessor`'s constructor and all internal
  references.
- No logic changes — only the type changes, since the field paths remain the same within the
  per-job object.

```typescript
// Before: private readonly config: Config
// After:  private readonly config: JobConfig
```

The same substitution applies to `ScreeningPipeline`'s internal helpers that currently read
`this.config.job.stages.intake`. Under the new schema, `this.config.stages.intake` (since `job`
wrapper is gone from `JobConfig` — the opening ID and stages are at the `JobConfig` root).

**Note:** The current `configSchema` has a `job` wrapper object inside the single-job config:
`config.job.openingId`, `config.job.stages`. In the new `JobConfig`, it makes sense to flatten
this: `jobConfig.openingId`, `jobConfig.stages` — removing the redundant `job` nesting since
the `JobConfig` IS the job.

### Updated Data Flow (Multi-Job)

```
Container starts
    │
    ▼
loadConfig() → Config { jobs: JobConfig[] }
    │
    ▼
ScreeningPipeline.run()
    │
    ├── for each jobConfig in config.jobs:
    │       │
    │       ├── validateStages(jobConfig) → stageMap
    │       │
    │       ├── fetchCandidates(jobConfig.openingId, intakeStageId)
    │       │
    │       └── for each application:
    │               CandidateProcessor(jobConfig).process(application, stageMap)
    │                 → hard rules → CV → soft eval → write → outcome
    │
    ▼
Per-job summaries logged to stderr
Full run summary JSON to stdout
    │
    ▼
Process exits
```

---

## Part 3: Secrets Injection on EC2

### The Problem

The current local setup uses `--env-file /etc/screener.env` passed to `docker run`. On EC2,
credentials must come from AWS Secrets Manager (never stored in a file on disk long-term, never
in the image, never in Terraform state).

### Two Candidate Approaches

**Approach A: Startup wrapper script reads Secrets Manager at cron time (RECOMMENDED)**

A shell script runs as the crontab entry instead of `docker run` directly. It calls
`aws secretsmanager get-secret-value`, extracts credentials into local variables, and passes
them as `-e` flags to `docker run`. The variables live in process memory only for the duration
of the script — no file is written to disk.

```bash
#!/usr/bin/env bash
# /opt/screener/run.sh — cron entry point on EC2

set -euo pipefail

REGION="eu-west-1"
SECRET_ID="bamboohr-screener/prod"

# Fetch secret JSON: { "BAMBOOHR_API_KEY": "...", "BAMBOOHR_SUBDOMAIN": "...", "OPENAI_API_KEY": "..." }
SECRET=$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --query SecretString \
  --output text)

BAMBOOHR_API_KEY=$(echo "$SECRET" | jq -r '.BAMBOOHR_API_KEY')
BAMBOOHR_SUBDOMAIN=$(echo "$SECRET" | jq -r '.BAMBOOHR_SUBDOMAIN')
OPENAI_API_KEY=$(echo "$SECRET" | jq -r '.OPENAI_API_KEY')

# Authenticate Docker to ECR
aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker run --rm \
  -e BAMBOOHR_API_KEY="$BAMBOOHR_API_KEY" \
  -e BAMBOOHR_SUBDOMAIN="$BAMBOOHR_SUBDOMAIN" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e LIVE_MODE="true" \
  -v /opt/screener/config.yaml:/app/config.yaml:ro \
  "${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/bamboohr-screener:latest"
```

The EC2 instance's IAM instance profile grants `secretsmanager:GetSecretValue` on the specific
secret ARN and `ecr:GetAuthorizationToken` + ECR pull permissions. No AWS credentials are stored
anywhere on disk.

**Approach B: Write env file to tmpfs, delete after docker run**

Write a temporary env file to `/run/screener.env` (tmpfs, RAM-only on Linux), pass it as
`--env-file`, then `rm` it. Marginally more complex than Approach A with no benefit for this
use case.

**Why Approach A is recommended:** Simpler (no file to manage), credentials only exist as shell
variables in the script's process, and the pattern is idiomatic for EC2 cron + Docker. The EC2
instance profile provides the AWS credentials transparently via the metadata service — no
credential file or `AWS_ACCESS_KEY_ID` env var needed.

**Why not SSM Parameter Store:** SSM Parameter Store Standard is free but limited to 4KB per
parameter. Storing three secrets individually is possible but requires three separate API calls.
Secrets Manager stores all three as one JSON document ($0.40/month total) and supports rotation.
For production credentials (BambooHR API key, OpenAI API key), Secrets Manager is the correct
choice. The $0.40/month cost is negligible.

### Secret Structure in Secrets Manager

One secret, JSON value:
```json
{
  "BAMBOOHR_API_KEY": "...",
  "BAMBOOHR_SUBDOMAIN": "...",
  "OPENAI_API_KEY": "..."
}
```

Secret ID: `bamboohr-screener/prod` (or parameterized via Terraform variable).

---

## Part 4: Minimum Terraform Resources for EC2 Cron

### Resource Inventory

These are the minimum Terraform resources needed. No VPC creation is required if the default
VPC is used (acceptable for this workload — it processes no inbound traffic, has no public
ports, and makes only outbound API calls).

| Resource | Terraform Type | Purpose |
|----------|---------------|---------|
| ECR repository | `aws_ecr_repository` | Stores Docker images |
| ECR lifecycle policy | `aws_ecr_lifecycle_policy` | Keep last N images, auto-delete old ones |
| IAM role | `aws_iam_role` | EC2 instance identity |
| IAM role policy | `aws_iam_role_policy` | Permissions: ECR pull + Secrets Manager read |
| IAM instance profile | `aws_iam_instance_profile` | Attaches role to EC2 instance |
| Security group | `aws_security_group` | Egress-only (outbound HTTPS to AWS + BambooHR + OpenAI) |
| EC2 instance | `aws_instance` | The cron host |
| Secrets Manager secret | `aws_secretsmanager_secret` + `aws_secretsmanager_secret_version` | Stores credentials |

**Optionally useful but not minimum:**
- CloudWatch log group — for capturing `docker run` stdout to CloudWatch (add `--log-driver awslogs` to docker run)
- `aws_eip` — stable IP if BambooHR has IP allowlist requirements (check with client)

### Key Resource Configurations

**IAM Role (trust policy: EC2 can assume)**
```hcl
resource "aws_iam_role" "screener" {
  name = "bamboohr-screener"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "ec2.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}
```

**IAM Role Policy (least-privilege: ECR pull + Secrets Manager read for specific secret)**
```hcl
resource "aws_iam_role_policy" "screener" {
  name = "bamboohr-screener-policy"
  role = aws_iam_role.screener.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["ecr:GetAuthorizationToken"]
        Resource = "*"  # GetAuthorizationToken is always Resource: *
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchCheckLayerAvailability"
        ]
        Resource = aws_ecr_repository.screener.arn
      },
      {
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue"]
        Resource = aws_secretsmanager_secret.screener.arn
      }
    ]
  })
}
```

**IAM Instance Profile**
```hcl
resource "aws_iam_instance_profile" "screener" {
  name = "bamboohr-screener"
  role = aws_iam_role.screener.name
}
```

**Security Group (egress-only)**
```hcl
resource "aws_security_group" "screener" {
  name        = "bamboohr-screener"
  description = "Outbound-only: screener makes no inbound connections"
  vpc_id      = data.aws_vpc.default.id

  egress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
    description = "HTTPS to AWS APIs, BambooHR, OpenAI"
  }
}
```

Note: Omit SSH ingress from the security group — use SSM Session Manager for access instead.
No key pair needed. This eliminates an entire attack surface.

**EC2 Instance with user_data**

The `user_data` script runs once at first boot and:
1. Installs Docker, AWS CLI v2, and jq
2. Writes the run script to `/opt/screener/run.sh`
3. Writes `config.yaml` to `/opt/screener/config.yaml` (or copies from S3)
4. Installs the crontab

```hcl
resource "aws_instance" "screener" {
  ami                    = data.aws_ami.amazon_linux_2023.id
  instance_type          = "t3.micro"
  iam_instance_profile   = aws_iam_instance_profile.screener.name
  vpc_security_group_ids = [aws_security_group.screener.id]

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    aws_account_id = data.aws_caller_identity.current.account_id
    aws_region     = var.aws_region
    ecr_image      = "${data.aws_caller_identity.current.account_id}.dkr.ecr.${var.aws_region}.amazonaws.com/bamboohr-screener:latest"
    secret_id      = aws_secretsmanager_secret.screener.name
    cron_schedule  = var.cron_schedule  # e.g. "0 7 * * 1-5"
  })

  root_block_device {
    volume_size = 20
    volume_type = "gp3"
  }

  tags = { Name = "bamboohr-screener" }
}
```

**user_data.sh.tpl (template file)**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Install dependencies
dnf install -y docker jq
systemctl enable --now docker

# Install AWS CLI v2 (Amazon Linux 2023 includes it; explicit for clarity)
# aws cli is pre-installed on AL2023 AMI

# Write the run script
mkdir -p /opt/screener
cat > /opt/screener/run.sh << 'RUNSCRIPT'
#!/usr/bin/env bash
set -euo pipefail
REGION="${aws_region}"
SECRET_ID="${secret_id}"
ECR_IMAGE="${ecr_image}"
AWS_ACCOUNT_ID="${aws_account_id}"

SECRET=$(aws secretsmanager get-secret-value \
  --region "$REGION" \
  --secret-id "$SECRET_ID" \
  --query SecretString \
  --output text)

BAMBOOHR_API_KEY=$(echo "$SECRET" | jq -r '.BAMBOOHR_API_KEY')
BAMBOOHR_SUBDOMAIN=$(echo "$SECRET" | jq -r '.BAMBOOHR_SUBDOMAIN')
OPENAI_API_KEY=$(echo "$SECRET" | jq -r '.OPENAI_API_KEY')

aws ecr get-login-password --region "$REGION" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

docker pull "$ECR_IMAGE"

docker run --rm \
  -e BAMBOOHR_API_KEY="$BAMBOOHR_API_KEY" \
  -e BAMBOOHR_SUBDOMAIN="$BAMBOOHR_SUBDOMAIN" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e LIVE_MODE="true" \
  -v /opt/screener/config.yaml:/app/config.yaml:ro \
  "$ECR_IMAGE"
RUNSCRIPT

chmod +x /opt/screener/run.sh

# Install crontab (runs as root — docker socket access)
echo "${cron_schedule} root /opt/screener/run.sh >> /var/log/screener.log 2>&1" \
  > /etc/cron.d/bamboohr-screener
chmod 0644 /etc/cron.d/bamboohr-screener
```

**config.yaml delivery:** The config file at `/opt/screener/config.yaml` needs to be on the
instance. Two options:
- Store in S3, download in `user_data` via `aws s3 cp` (recommended — config is not a secret,
  S3 is durable, and updates don't require reprovisioning the instance)
- Embed in `user_data` via Terraform `templatefile` (simpler but requires `terraform apply` to
  update config)

For v1.1, embedding in `user_data` is acceptable. For a production follow-up, S3 delivery is
cleaner because config can be updated without touching Terraform.

### AMI Selection

Use Amazon Linux 2023 (AL2023). It includes Docker and AWS CLI v2 in the package manager,
receives security patches, and is the current AWS default. Use a `data` source to pin to the
latest AL2023 AMI rather than hardcoding an AMI ID (which goes stale).

```hcl
data "aws_ami" "amazon_linux_2023" {
  most_recent = true
  owners      = ["amazon"]
  filter {
    name   = "name"
    values = ["al2023-ami-2023*-x86_64"]
  }
}
```

### Instance Type

`t3.micro` (2 vCPU burstable, 1 GiB RAM). The screener container runs for a few minutes and
exits — it does not need sustained CPU. t3.micro costs ~$8/month. If the account is within the
AWS Free Tier window, `t2.micro` qualifies for 750 hours/month free.

### ECR Repository

```hcl
resource "aws_ecr_repository" "screener" {
  name                 = "bamboohr-screener"
  image_tag_mutability = "MUTABLE"  # allows :latest re-tagging

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "screener" {
  repository = aws_ecr_repository.screener.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep last 5 images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = 5
      }
      action = { type = "expire" }
    }]
  })
}
```

---

## Part 5: Deploy Script Design

Three operations are needed: build, push to ECR, and trigger the EC2 instance to pull and run.
These can be a single `deploy.sh` or separate scripts.

```bash
#!/usr/bin/env bash
# scripts/deploy.sh
set -euo pipefail

AWS_REGION="eu-west-1"
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com/bamboohr-screener"
IMAGE_TAG="${1:-latest}"

echo "==> Building image..."
docker build -t "bamboohr-screener:${IMAGE_TAG}" .

echo "==> Authenticating to ECR..."
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin \
    "${AWS_ACCOUNT_ID}.dkr.ecr.${AWS_REGION}.amazonaws.com"

echo "==> Tagging and pushing..."
docker tag "bamboohr-screener:${IMAGE_TAG}" "${ECR_REPO}:${IMAGE_TAG}"
docker push "${ECR_REPO}:${IMAGE_TAG}"

if [ "$IMAGE_TAG" != "latest" ]; then
  docker tag "bamboohr-screener:${IMAGE_TAG}" "${ECR_REPO}:latest"
  docker push "${ECR_REPO}:latest"
fi

echo "==> Done. EC2 will pull :latest on next cron trigger."
echo "    To run immediately: use SSM Session Manager to trigger run.sh manually."
```

The EC2 instance always pulls `:latest` at cron time (`docker pull` is at the top of `run.sh`),
so a new image is picked up on the next scheduled run automatically. No SSH or `docker restart`
needed.

For an immediate out-of-cycle run, use SSM Run Command (no SSH key needed):
```bash
aws ssm send-command \
  --instance-ids "i-0123456789abcdef0" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["/opt/screener/run.sh"]'
```

---

## Part 6: Suggested Build Order for v1.1 Phases

The three feature areas have dependencies. The correct order avoids rework:

### Phase 6: Multi-Job Config + Pipeline (no AWS dependency)

Build first because it is pure TypeScript with no external infrastructure dependency. Can be
tested locally with the existing Docker setup.

**Steps:**
1. Update `configSchema` in `schema.ts` — `jobs: z.array(jobConfigSchema).min(1)`
2. Update `loadConfig()` — no logic change, just type updates cascade from schema
3. Update `CandidateProcessor` — change constructor from `Config` to `JobConfig`
4. Update `ScreeningPipeline` — add outer `for...of config.jobs` loop, extract `runJob(jobConfig)`
5. Update `index.ts` — constructs one `ScreeningPipeline` with full `Config`; no change needed
   if Option A (outer loop in pipeline) is chosen
6. Migrate `config.yaml` and `config.example.yaml` to new `jobs:` array format
7. Update all tests (unit tests for `CandidateProcessor` and `ScreeningPipeline` need type updates)
8. Manual dry-run test with two-job config

**What does NOT change:** `CandidateProcessor.process()` logic, `SoftEvaluator`, `BambooHRClient`,
`LiveModeWriter`, `CommentBuilder`, `HardRulesEvaluator`, `JsonLogger`. The pipeline logic is
unchanged — only the wiring and config shape change.

### Phase 7: Terraform Infrastructure (depends on Phase 6 image being stable)

Build second because Terraform provisions infrastructure that assumes the image works. Provision
with an image tag before writing deploy scripts.

**Steps:**
1. Create `terraform/` directory with `main.tf`, `variables.tf`, `outputs.tf`
2. Implement resources in order of dependency:
   - Data sources: `aws_caller_identity`, `aws_ami`, `aws_vpc` (default)
   - `aws_secretsmanager_secret` + `aws_secretsmanager_secret_version`
   - `aws_ecr_repository` + `aws_ecr_lifecycle_policy`
   - `aws_iam_role` + `aws_iam_role_policy` + `aws_iam_instance_profile`
   - `aws_security_group`
   - `aws_instance` with `user_data`
3. `terraform init && terraform plan` — review before apply
4. `terraform apply` — provisions infrastructure
5. Manually push an image to ECR, SSH via SSM to verify `run.sh` executes correctly

### Phase 8: Deploy Scripts + Cron Verification (depends on Phase 7 infrastructure existing)

Build last because deploy scripts need a real ECR URL and a running EC2 instance.

**Steps:**
1. Write `scripts/deploy.sh` (build + tag + push + optional immediate trigger)
2. Test full deploy flow: `npm run build → docker build → deploy.sh`
3. Trigger `run.sh` via SSM Run Command — verify logs, verify BambooHR stage moves in dry-run
4. Enable cron by verifying `/etc/cron.d/bamboohr-screener` is installed and fires at schedule
5. Verify `LIVE_MODE=true` path end-to-end before sign-off

### Dependency Graph

```
Phase 6 (Multi-job TypeScript)
    │
    │  (Phase 6 complete → Docker image with multi-job support built)
    │
    ▼
Phase 7 (Terraform)
    │
    │  (Phase 7 complete → ECR repo exists, EC2 running, IAM wired)
    │
    ▼
Phase 8 (Deploy scripts + cron verification)
```

Phase 6 and Phase 7 can be planned in parallel (plans written simultaneously) but Phase 7
execution requires Phase 6 to be complete so a valid image can be pushed and tested.

---

## Component Boundary Summary (v1.1)

```
src/index.ts
    └── loadConfig() → Config { jobs: JobConfig[] }
    └── constructs shared: BambooHRClient, SoftEvaluator, JsonLogger
    └── constructs ScreeningPipeline(client, processor, logger, config, dryRun)
    └── pipeline.run()

src/screener/screening-pipeline.ts
    └── for each JobConfig in config.jobs:
            └── validateStages(jobConfig) → stageMap
            └── fetchCandidates(jobConfig.openingId, intakeId)
            └── for each application:
                    └── candidateProcessor.process(application, stageMap)
                        [candidateProcessor needs JobConfig, not full Config]

src/pipeline/candidate-processor.ts
    └── config: JobConfig  ← type change only
    └── all logic unchanged

src/config/schema.ts
    └── jobConfigSchema  ← new, extracted from current configSchema
    └── configSchema     ← now wraps jobs: z.array(jobConfigSchema).min(1)

terraform/
    └── ECR repo
    └── Secrets Manager secret
    └── IAM role + policy + instance profile
    └── Security group
    └── EC2 instance (user_data installs Docker, writes run.sh, sets cron)

scripts/
    └── deploy.sh  ← build, push to ECR, tag :latest
```

---

## Risks and Mitigations

| Risk | Likelihood | Consequence | Mitigation |
|------|-----------|-------------|------------|
| Breaking YAML change breaks existing config | HIGH | Container fails to start | Include config migration in Phase 6 plan; update `config.example.yaml` and document migration |
| `user_data` script fails silently on first boot | MEDIUM | Cron never installs; no error visible | Check `/var/log/cloud-init-output.log` via SSM; add `set -euo pipefail` to user_data |
| ECR authentication expires during long run | LOW | `docker pull` fails | The run script re-authenticates at the top of every invocation — token is fresh each time |
| Secrets Manager returns stale cached value | LOW | Old credential used | Secrets Manager has no client-side caching in this pattern — `get-secret-value` always fetches live |
| Per-job stage validation fails for one job | MEDIUM | Entire run aborts | Option: catch `StageValidationError` per job in the outer loop and continue to next job, logging the error |
| Two jobs share same BambooHR opening + different stages | LOW | Stage conflict | Enforce `openingId` uniqueness across jobs in Zod schema with `.superRefine()` |

---

## Sources

- Terraform Registry: `aws_iam_instance_profile`, `aws_iam_role`, `aws_ecr_repository`,
  `aws_ecr_lifecycle_policy`, `aws_instance` — MEDIUM confidence (verified resource names via
  web search against registry.terraform.io)
- AWS documentation: Secrets Manager `get-secret-value` CLI pattern, EC2 instance profile
  IAM pattern — MEDIUM confidence (patterns confirmed via AWS re:Post and AWS blog)
- Existing codebase: `src/config/schema.ts`, `src/screener/screening-pipeline.ts`,
  `src/pipeline/candidate-processor.ts`, `src/index.ts`, `Dockerfile` — HIGH confidence
  (code read directly)
- SSM Parameter Store vs Secrets Manager comparison — MEDIUM confidence (multiple consistent
  sources: tutorialsdojo.com, cloudonaut.io, ranthebuilder.cloud)

---
*Architecture research for: BambooHR Candidate Screener v1.1 — Multi-Job & AWS Deployment*
*Researched: 2026-05-04*
