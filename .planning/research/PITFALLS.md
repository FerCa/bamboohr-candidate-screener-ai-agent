# Pitfalls Research

**Domain:** BambooHR candidate screening agent (TypeScript + OpenAI Agents SDK + Docker + cron)
**Researched (v1.0):** 2026-05-01 | **Researched (v1.1 additions):** 2026-05-04
**Confidence:** MEDIUM overall — BambooHR API and OpenAI SDK claims from training data (cutoff August 2025). AWS/Terraform/ECR claims verified via web search May 2026. Flag BambooHR-specific claims for manual verification against https://documentation.bamboohr.com before shipping.

---

## v1.1 Milestone Pitfalls: Multi-Job & AWS Deployment

These pitfalls are specific to the work being added in Milestone v1.1. v1.0 pitfalls follow in the section below.

---

### Area 1: Multi-Job Config

---

#### MJ-01: Schema Rewrite Breaks Existing Single-Job `config.yaml` Files

**What goes wrong:**
The current `configSchema` has a top-level `job` key (a single object with `openingId` and `stages`). Naively migrating to `jobs` (an array) invalidates every existing `config.yaml` that uses the old `job:` key. Operators who have a working v1.0 setup get a `ConfigError` immediately after upgrading. If the schema change is also a breaking rename (not a superset), you cannot even have a transition period.

**Why it happens:**
Engineers think in terms of the new shape and replace the old key rather than extending the schema to accept both forms. The Zod `.refine()` guard on `hardRules` (which must contain at least one rule) is already a good pattern here but the `job` object is not guarded the same way.

**How to prevent:**
Use an expand-then-contract pattern. In the first PR, make the schema accept both the legacy `job: { ... }` key and the new `jobs: [...]` array. In the loader, detect which key is present and normalize to the array form internally. Only deprecate `job:` in a later cleanup. In Zod this is cleanly done with `z.union([legacySchema, multiJobSchema])` parsed before schema validation, or by making `jobs` optional with a default derived from `job`. Concrete shape:

```typescript
// Accept either jobs array OR legacy job object — normalize inside loader.ts
const rawWithJobs = 'jobs' in raw ? raw : { ...raw, jobs: [raw.job], job: undefined };
```

Mark the config template with a deprecation notice rather than removing the old key immediately.

**Phase to address:** Multi-job config phase — first PR must include backward-compatible schema, not a hard cutover.

---

#### MJ-02: Per-Job Error Isolation Not Extended to Job Loop

**What goes wrong:**
The existing `ScreeningPipeline.run()` has a solid per-candidate SAFE-01 try/catch: one candidate failing does not abort the run. When iterating over N jobs, developers often forget to apply the same pattern at the job level. If Job 2's `validateStages()` throws (a stage was renamed overnight), the entire run aborts and Job 3 and Job 4 are never processed.

**Why it happens:**
The pattern exists in the code but only at the candidate loop level. Adding a multi-job outer loop naturally inherits the code style without the try/catch because the job-level failure looks "fatal" — the developer thinks "if stages are wrong, why continue?" But partial processing is better than no processing.

**How to prevent:**
Wrap the per-job block in its own try/catch. On job-level failure, log a structured error line (`{ outcome: 'job_error', jobId: ..., reason: ... }`) and `continue` to the next job. This mirrors SAFE-01 exactly, one level up. Update the run summary JSON to include a `jobErrors` counter alongside `processed`, `pass`, `fail`.

**Phase to address:** Multi-job config phase — define the job-level try/catch in the ScreeningPipeline redesign before coding the loop.

---

#### MJ-03: `fieldMap` and Rule Types Are Job-Specific but Shared in Config

**What goes wrong:**
The current schema has a single top-level `fieldMap` (a `z.record(z.string(), z.string())`) used to map rule field names to BambooHR application field keys. When supporting multiple jobs, each job may have different application questions with different field keys. A rule like `requiredKeyword.field: "employmentType"` maps to BambooHR field `234` for Job A but to field `891` for Job B. If `fieldMap` stays global, Job B's rules silently use Job A's field mapping and evaluate the wrong application fields — no error is thrown.

**Why it happens:**
The fieldMap was designed for a single job. It's natural to leave it at the top level when first adding `jobs` as an array, not realizing each job can have a structurally different application form in BambooHR.

**How to prevent:**
Move `fieldMap`, `hardRules`, and `softRules` inside each job object in the new schema. Each job entry becomes self-contained: `{ openingId, stages, fieldMap, hardRules, softRules }`. Validate that each job block independently satisfies the "at least one hard rule" constraint. The `CandidateProcessor` already receives `config` as a constructor argument — swap to receiving a per-job config slice instead of the full config. This is a clean refactor because Phase 5 already injected dependencies through constructors.

**Phase to address:** Multi-job config phase — define the per-job schema shape before any code is written; migrating this later is painful.

---

#### MJ-04: Stage Validation Called Once for All Jobs — Wrong Stages Used

**What goes wrong:**
The current `validateStages()` is called once at startup and returns a single `stageMap`. That map is then used throughout the run. For multi-job, each job opening in BambooHR has its own pipeline with its own stage IDs. If `validateStages()` is only called once (for Job 1's pipeline), the stageMap built for Job 1 is used for Job 2's stage moves. BambooHR returns HTTP 200 for a valid-but-wrong stage ID, so candidates get silently moved to Job 1's stages while in Job 2's pipeline — producing corrupt ATS state.

**Why it happens:**
The existing code calls `validateStages(config)` and passes the whole config. Developers add the outer job loop but forget to call `validateStages()` per job.

**How to prevent:**
Call `validateStages(jobConfig)` inside the per-job loop, passing only the relevant job config slice. Each job gets its own `stageMap`. The extra API calls are acceptable because the outer loop runs at most a handful of jobs, not hundreds.

**Phase to address:** Multi-job config phase — update ScreeningPipeline.run() to call validateStages inside the per-job block, not in a one-time preamble.

---

#### MJ-05: Run Time Grows Linearly with Job Count — Cron Window Exceeded

**What goes wrong:**
A single-job run typically completes in under 2 minutes (a few candidates, sequential processing). With N jobs, each with their own candidate batch, the total run time grows linearly. A cron window of `0 11 * * *` (daily at 11am) doesn't enforce a timeout on `docker run`. If one job has an unusually large batch (post-launch surge of applicants), the container may run for 20+ minutes. If the next cron trigger fires and the previous run is still active, two containers run concurrently — sharing the BambooHR rate limit and potentially double-processing candidates.

**Why it happens:**
The original design assumed "a small daily batch." Multi-job scales this assumption without questioning it.

**How to prevent:**
Add a global run timeout: set `--stop-timeout` on `docker run`, or implement a `Promise.race()` at the top level with a wall-clock deadline. Log elapsed time per job in the summary. Add a startup check: if a `.lock` file exists at the mounted volume path and was created within the last 4 hours, exit immediately with a log line `[main] Previous run still active — skipping.` This is the lightweight idempotency guard that was already deferred from v1.0 (SAFE-03 in STATE.md) and becomes critical for multi-job.

**Phase to address:** Multi-job config phase — add the `.lock` file guard when implementing the outer job loop; it directly prevents the worst-case overlap scenario.

---

### Area 2: EC2 / Terraform Deployment

---

#### TF-01: `user_data` Runs Only on First Boot — Configuration Drift Goes Undetected

**What goes wrong:**
EC2 `user_data` (cloud-init scripts) runs exactly once: on the first boot after instance creation. If you update your Terraform configuration — changing the cron schedule, updating an environment variable, or adding a new package — the `terraform apply` shows "update in-place" (because `user_data_replace_on_change` defaults to `false` since the AWS provider 4.x+ change). The apply completes successfully, but the EC2 instance is still running the old configuration. There is no error and no indication anything is wrong. The instance reboots silently without re-running the script.

**Why it happens:**
Developers expect `terraform apply` to converge the running state to the desired state, the way it does for security groups or tags. For `user_data`, it does not — it only converges the instance *metadata*, not the running configuration inside the instance.

**How to prevent:**
Make `user_data` truly idempotent: every script operation must be safe to re-run (install packages with `--no-upgrade`, write files with `tee` rather than `>>`, register cron jobs by overwriting not appending — the existing `install.sh` already does this correctly with the grep-then-write crontab pattern). Set `user_data_replace_on_change = true` in the Terraform `aws_instance` block so that any change to `user_data` triggers a full instance replacement, making the behavior predictable. Document that instance replacement is the expected apply mechanism, not in-place update. For the short-lived cron container pattern, instance replacement is a non-event: there is no in-flight workload to interrupt.

**Phase to address:** EC2/Terraform phase — set `user_data_replace_on_change = true` from day one; do not leave it at the default.

---

#### TF-02: Secrets in Terraform State and Plan Files

**What goes wrong:**
If API keys (BambooHR, OpenAI) are passed into Terraform as `variable` values and rendered into `user_data` scripts (e.g., inline into a heredoc that writes a `.env` file), those secret values are stored in the Terraform state file in plaintext. Anyone with read access to the state file — including CI/CD pipelines, developers with S3 read permission, and future incident responders — can extract the keys. Terraform plan files (`.tfplan`) also contain the same values.

**Why it happens:**
The simplest Terraform pattern for "put this value on the machine" is to interpolate a `var.api_key` into `user_data`. It works. The state storage consequence is invisible.

**How to prevent:**
Store secrets in AWS SSM Parameter Store (type `SecureString`) before running Terraform. In `user_data`, fetch the secrets at boot time using the AWS CLI against the SSM API, not from Terraform variables:

```bash
export BAMBOOHR_API_KEY=$(aws ssm get-parameter --name /screener/bamboohr-api-key --with-decryption --query Parameter.Value --output text)
```

Terraform only stores the SSM parameter *name* (a non-secret string), not the value. The EC2 instance's IAM role grants `ssm:GetParameter` for those specific parameter paths. Use `sensitive = true` on any Terraform output or variable that does touch secret values (prevents them from appearing in `terraform output` unless explicitly requested with `-raw`). Store Terraform state in S3 with server-side encryption (KMS) and DynamoDB locking (or the newer S3 native locking with `use_lockfile = true` in Terraform AWS provider 5.x+).

**Phase to address:** EC2/Terraform phase — SSM pattern must be designed before any `user_data` script is written; retrofitting it after secrets are already in state requires rotating all keys.

---

#### TF-03: IAM Role Granted More Than It Needs

**What goes wrong:**
The EC2 instance needs three permissions: pull from ECR, read secrets from SSM, and write to CloudWatch Logs (optional but common). Developers often grant `AmazonEC2ContainerRegistryFullAccess` (allows creating and deleting repositories) and `AmazonSSMFullAccess` (allows writing parameters and managing SSM sessions) instead of the narrower read-only equivalents. Over-permissioned instance roles are a significant blast radius in the event of instance compromise: an attacker can exfiltrate all SSM parameters, push malicious images to ECR, or pivot to other AWS resources.

**Why it happens:**
AWS managed policies are convenient. Finding the exact `Action` list for least-privilege IAM takes research. Developers prioritize getting it working over getting it scoped.

**How to prevent:**
Write a custom IAM policy with exactly the required actions and resource ARNs:

```json
{
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["ecr:GetAuthorizationToken"],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"],
      "Resource": "arn:aws:ecr:REGION:ACCOUNT:repository/bamboohr-screener"
    },
    {
      "Effect": "Allow",
      "Action": ["ssm:GetParameter"],
      "Resource": [
        "arn:aws:ssm:REGION:ACCOUNT:parameter/screener/*"
      ]
    }
  ]
}
```

`ecr:GetAuthorizationToken` requires `Resource: *` by AWS design — this is expected and documented. All other resources should use exact ARNs. Do not use `Resource: *` for SSM.

**Phase to address:** EC2/Terraform phase — write the inline IAM policy in Terraform before creating the instance; do not start from a managed policy and trim later.

---

#### TF-04: ECR Token Expires Every 12 Hours — Unattended Pulls Fail

**What goes wrong:**
ECR uses temporary tokens valid for exactly 12 hours. If the deploy script logs in once at deploy time (by running `aws ecr get-login-password | docker login ...`), the Docker daemon caches that token. Any `docker pull` that happens more than 12 hours after the last login will fail with `no basic auth credentials` or `401 Unauthorized`. For a daily cron job that runs `docker pull` to check for updates, this means the pull fails on any day where the last login was more than 12 hours ago.

**Why it happens:**
Manual `docker login` works perfectly in a CI/CD pipeline where each run starts fresh. On a persistent EC2 instance, there is no "fresh run" — the Docker daemon keeps cached credentials that silently expire.

**How to prevent:**
Install the Amazon ECR Credential Helper (`amazon-ecr-credential-helper`) on the EC2 instance. Configure `~/.docker/config.json` to use it:

```json
{
  "credHelpers": {
    "ACCOUNT.dkr.ecr.REGION.amazonaws.com": "ecr-login"
  }
}
```

The credential helper automatically fetches a fresh ECR token on every `docker pull` using the instance's IAM role — no cached tokens, no expiry problem. This is the correct pattern for persistent EC2 instances. The `user_data` script should install the credential helper as part of initial setup (`apt install amazon-ecr-credential-helper` on Ubuntu or the equivalent binary install on Amazon Linux 2023).

Alternatively: run `aws ecr get-login-password | docker login` inside the cron wrapper script itself (before `docker pull`). Since the cron fires once daily, this ensures a fresh token on every run. The credential helper approach is cleaner and does not require the AWS CLI to be available in the same shell context.

**Phase to address:** EC2/Terraform phase — `user_data` must install the ECR credential helper; do not use a one-time `docker login` in the deploy script.

---

#### TF-05: Security Group Too Permissive — Instance Exposed to Internet

**What goes wrong:**
When creating a security group for the EC2 instance in Terraform, developers frequently use `cidr_blocks = ["0.0.0.0/0"]` for all inbound rules to avoid SSH access issues during testing. The screener runs as a cron-triggered container with no inbound traffic requirements. An open security group exposes the instance to port scanners and brute-force attacks with no benefit.

**Why it happens:**
Copy-paste from tutorials that assume you need SSH access. The screener container doesn't expose any ports, so developers don't notice the security group is irrelevant to the application but relevant to the host.

**How to prevent:**
The security group for this instance should have zero inbound rules — no SSH, no HTTP, nothing. All outbound rules are fine (HTTPS to BambooHR, OpenAI, ECR, SSM). If SSH is needed for debugging, use AWS Systems Manager Session Manager (SSM Sessions) instead of an open SSH port — it requires no inbound security group rule and logs all commands via CloudTrail. In Terraform: `ingress = []` (empty inbound rules block).

**Phase to address:** EC2/Terraform phase — define the security group with explicit empty ingress before reviewing with any security check.

---

#### TF-06: `user_data` Contains Credentials Visible in AWS Console

**What goes wrong:**
Even after removing secrets from Terraform variables (per TF-02), it is easy to accidentally write a `user_data` script that echoes values into shell variables in ways that get logged. The EC2 instance's `user_data` is visible in the AWS Console under Instance Settings → User Data — in plaintext to anyone with `ec2:DescribeInstanceAttribute` permission. If the `user_data` script constructs a `.env` file by concatenating literal values (even fetched from SSM at boot), the values may appear in `set -x` debug output or shell history.

**Why it happens:**
Developers add `set -x` to debug boot scripts — reasonable locally, dangerous on an instance that fetches secrets at boot.

**How to prevent:**
Never use `set -x` in any script that handles credentials. Redirect sensitive variable assignments to `/dev/null` if debug logging is needed. Fetch SSM values and export them directly into the Docker run environment without writing them to disk:

```bash
BAMBOOHR_API_KEY=$(aws ssm get-parameter --name /screener/bamboohr-api-key --with-decryption --query Parameter.Value --output text 2>/dev/null)
docker run --rm -e BAMBOOHR_API_KEY="$BAMBOOHR_API_KEY" ...
```

Do not write a `.env` file to disk on the EC2 instance; pass credentials directly to `docker run -e`. This avoids the risk of `.env` files being readable by other users or processes on the host.

**Phase to address:** EC2/Terraform phase — review the cron wrapper script and user_data for any credential-handling before merging.

---

### Area 3: Deploy Scripts

---

#### DS-01: Deploy Script Assumes AWS CLI Credentials Are Configured — Fails Silently in Different Environments

**What goes wrong:**
A deploy script that pushes to ECR with `aws ecr get-login-password | docker login ...` works on the developer's macOS because `~/.aws/credentials` or an SSO session is active. The same script fails in CI/CD or on a different machine with a cryptic `Unable to locate credentials` error that exits with code 255, not a meaningful error. If the script uses `set -e`, it stops there; if it doesn't, `docker push` runs with expired credentials and fails with `401 Unauthorized` rather than "credentials missing".

**Why it happens:**
The developer tests the script in their own environment and it works. They don't test it in a fresh environment or document the pre-requisite credential setup.

**How to prevent:**
Add an explicit credential check at the top of the script:

```bash
aws sts get-caller-identity --query Account --output text > /dev/null || {
  echo "ERROR: AWS credentials not configured. Run 'aws sso login' or set AWS_PROFILE."
  exit 1
}
```

This runs before any ECR or Docker operations and produces a useful error message. Document in the script header which AWS profile or credential method is expected. Always use `set -euo pipefail` at the top (the existing `install.sh` does this correctly — apply the same pattern to the deploy script).

**Phase to address:** Deploy scripts phase — add the credential preflight check before any ECR interaction.

---

#### DS-02: `docker push` Pushes to Wrong Region or Account

**What goes wrong:**
ECR repository URLs are account and region-specific: `123456789012.dkr.ecr.eu-west-1.amazonaws.com/bamboohr-screener`. If the deploy script hardcodes the ECR URL rather than deriving it from Terraform outputs or AWS account metadata, a developer with a different default region (`AWS_DEFAULT_REGION`) or a different AWS account (dev vs. prod) accidentally pushes to the wrong registry — or fails to push at all because the repository doesn't exist in that account/region.

**Why it happens:**
ECR URLs look like constants. Developers copy-paste from a one-time setup and hardcode them. The mistake is invisible if the push succeeds (the image lands in the wrong account) or fails with an authentication error that doesn't mention the actual problem.

**How to prevent:**
Derive the ECR URL dynamically in the deploy script rather than hardcoding it:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=$(aws configure get region)
ECR_URL="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/bamboohr-screener"
```

Alternatively, output the ECR repository URL from Terraform (`output "ecr_repository_url"`) and read it in the deploy script with `terraform output -raw ecr_repository_url`. This makes the deploy script derive truth from Terraform, not from hardcoded strings.

**Phase to address:** Deploy scripts phase — derive ECR URL from environment/Terraform output from the beginning; never hardcode account IDs or regions.

---

#### DS-03: EC2 Update Script Uses SSH — Credential Management and Firewall Problem

**What goes wrong:**
The naive "update the running EC2 instance" approach is: SSH into the instance, run `docker pull`, restart the cron container. This requires maintaining SSH keys, keeping port 22 open in the security group (contradicting TF-05), and managing key rotation. Storing an SSH private key in CI/CD secrets is a common credential leak vector. If the key is ever rotated or the instance is replaced by Terraform, the key in CI/CD becomes stale.

**Why it happens:**
SSH is the traditional way to run remote commands on Linux. It's the first tool developers reach for.

**How to prevent:**
For this workload, there is no need to push updates to the EC2 instance at deploy time. The instance's cron job runs `docker pull` before `docker run`. The deploy script only needs to push a new image to ECR; the instance picks it up on the next scheduled run. This is the correct pattern for a cron-triggered short-lived container:

```
Deploy script (runs locally/CI):
  1. docker build + docker tag
  2. aws ecr get-login-password | docker login
  3. docker push

EC2 cron (runs daily):
  0 11 * * * /opt/screener/run.sh

/opt/screener/run.sh:
  aws ecr get-login-password | docker login ...   # (or use ECR credential helper)
  docker pull $ECR_URL:latest
  docker run --rm -e ... $ECR_URL:latest
```

No SSH required. No port 22 open. No key management. The one delay is that the EC2 instance runs the new image on the *next* cron trigger, not immediately after pushing — which is acceptable for a daily screener.

If immediate update is required, use `aws ssm send-command` to run a shell command on the instance via Systems Manager — no SSH port, no key management, audited via CloudTrail.

**Phase to address:** Deploy scripts phase — design the pull-on-run pattern into the cron wrapper script from the start; document that "deploy = push to ECR" not "push to ECR + SSH to instance."

---

#### DS-04: Deploy Script Tags Only `latest` — Rollback Impossible

**What goes wrong:**
If the deploy script only tags and pushes `latest`, rolling back to a previous version requires rebuilding the old image from source. If the build environment has changed (Node.js version bump, dependency update) or the source is ambiguous (the current commit on `main` is now the broken one), reconstruction is difficult. ECR allows up to 1,000 images per repository — not using versioned tags wastes this safety net entirely.

**Why it happens:**
`latest` is the default Docker convention. It requires zero thought to use. Developers don't plan for rollback until they need one.

**How to prevent:**
Tag with both `latest` and a content-addressed tag in the deploy script:

```bash
GIT_SHA=$(git rev-parse --short HEAD)
docker tag bamboohr-screener:latest $ECR_URL:$GIT_SHA
docker tag bamboohr-screener:latest $ECR_URL:latest
docker push $ECR_URL:$GIT_SHA
docker push $ECR_URL:latest
```

In the EC2 cron wrapper, use `latest` for normal operation (always picks up the newest image). To roll back, update the cron wrapper to pull a specific SHA tag instead of `latest`. Set an ECR lifecycle policy to retain the last 10 images and expire older ones to avoid unbounded storage growth.

**Phase to address:** Deploy scripts phase — add SHA tagging from the first deploy script; it costs one extra line and zero infrastructure.

---

#### DS-05: Sensitive Values Leak Through Shell History or Script Output

**What goes wrong:**
Deploy scripts that echo environment variables for debugging (`echo "API_KEY=$BAMBOOHR_API_KEY"`) or pass credentials as shell arguments (`docker run -e BAMBOOHR_API_KEY=abc123 ...`) expose secrets in shell history (`~/.bash_history`), `ps aux` output (command line arguments are visible to all users on the host), and CI/CD log files. A `docker run` with inline `-e KEY=VALUE` arguments is visible to any user who can run `ps aux` on the host at the moment the container starts.

**Why it happens:**
Debugging during development requires seeing values. The pattern gets committed without removing the debug output. Passing `-e KEY=VALUE` inline is the simplest way to get variables into a container.

**How to prevent:**
- For the deploy script (local/CI): never echo credential values. Echo only the parameter *name* (`echo "Using SSM parameter: /screener/bamboohr-api-key"`).
- For `docker run` on EC2: use `--env-file` with a file written to a tmpfs (in-memory) location, or pass values as `-e KEY="$VALUE"` where `$VALUE` is a shell variable (not a literal) — shell variable expansion is not visible in `ps aux`.
- Alternatively (cleanest): inject credentials from SSM at the start of the wrapper script into a temporary file in `/run/secrets/` (a RAM-backed tmpfs on modern Linux), mount that file into the container, delete it after `docker run` completes.
- Set `HISTIGNORE="*BAMBOOHR*:*OPENAI*"` in the shell profile used by cron to prevent sensitive command lines from being written to history.

**Phase to address:** Deploy scripts phase — audit the wrapper script for any literal credential output before merging.

---

#### DS-06: Terraform `apply` in CI Requires Broad IAM Permissions — Over-Permissioned CI Credentials

**What goes wrong:**
Running `terraform apply` requires IAM permissions to create EC2 instances, security groups, IAM roles, SSM parameters, ECR repositories, and S3 buckets. If a single set of long-lived IAM access keys is used for both the CI pipeline and the developer's local environment, a compromised key has a blast radius equal to all those resource types. Long-lived access keys also cannot be rotated automatically.

**Why it happens:**
CI/CD setup is often an afterthought. The developer uses their own IAM user credentials locally, copies them into CI/CD secrets, and ships it.

**How to prevent:**
Use a dedicated IAM role for CI/CD with `sts:AssumeRole` from the CI/CD provider (GitHub Actions OIDC is the correct pattern for GitHub-hosted runners — no long-lived keys at all). The role should have only the permissions needed to run `terraform apply` for this specific project, scoped to the resource ARNs Terraform will manage. Separate the "apply Terraform" role from the "push to ECR" role. For local development, use AWS SSO or temporary credentials from `aws sts assume-role`.

**Phase to address:** EC2/Terraform phase — create the CI/CD IAM role in Terraform itself (self-referential, but achievable with `terraform import` for the initial role); document the OIDC setup.

---

## v1.0 Pitfalls (Original Screening Agent Domain)

---

### Critical Pitfalls

#### Pitfall 1: Double-Processing Candidates — No Idempotency Guard

**What goes wrong:**
The agent runs daily via cron. If a candidate is in "New" status and the run crashes after the OpenAI call but before the BambooHR status-move write, or the BambooHR write silently fails, the candidate remains in "New" on the next run and gets re-evaluated. GPT-4o generates a different comment (it is stochastic), a second comment gets posted to BambooHR, and the stage move fires again — possibly conflicting with a recruiter who manually moved the candidate in between.

**Why it happens:**
No persistent state. Each container run is stateless. Without a record of "this candidate ID was already processed," the agent cannot distinguish between truly new candidates and ones that slipped through on a prior run. The BambooHR `GET /v1/applicant_tracking/applications` endpoint returns candidates by current stage, not by "when they entered this stage," so checking the current stage is not a reliable idempotency key.

**How to avoid:**
Write a processed-candidates log to a mounted volume (e.g., `processed.json` with `{ candidateId, applicationId, processedAt, decision }` entries). At run start, load this log and skip any ID already present. Alternatively, use the BambooHR comment API to check if a comment from this agent already exists on the application before posting. A file-based log is simpler and survives container restarts; make the volume mount a first-class requirement in the Docker run command.

**Warning signs:**
- Recruiters report seeing two identical or near-identical automated comments on a single candidate
- Structured logs show the same `applicationId` appearing in two separate run outputs
- BambooHR audit trail shows the same stage transition twice within 24 hours

**Phase to address:**
Phase 1 (BambooHR integration foundation) — bake the idempotency log into the initial data-fetch design before any writes are implemented.

---

#### Pitfall 2: BambooHR Pipeline Stage IDs Are Not Human-Readable — Wrong Stage Moves

**What goes wrong:**
BambooHR hiring pipeline stages are identified by integer IDs, not names. The IDs are account-specific and not globally standardized. "Schedule Phone Screen" in one BambooHR account is stage `12`, in another it is stage `7`. The YAML config requires the operator to look up and enter the correct integer IDs. If they enter the wrong IDs — or if a BambooHR admin renames or deletes a stage — the agent silently moves candidates to the wrong stage with no error (BambooHR typically returns HTTP 200 for a valid-but-wrong stage ID that exists in the account).

**Why it happens:**
The naming is genuinely confusing and inconsistently documented. Third-party blog posts about the BambooHR API frequently use "candidate" and "applicant" interchangeably, compounding the confusion.

**How to avoid:**
At startup, call `GET /v1/applicant_tracking/pipelines` (or the equivalent pipeline-fetch endpoint) to retrieve all pipeline stages for the configured job opening. Cross-reference the IDs in the YAML config against the returned stage names and log a startup validation warning if a configured ID is not found or the name does not match expectation. Never trust that a numeric ID is correct without this validation step. Document in the YAML config template that IDs must be obtained from the BambooHR UI or API, not guessed.

**Warning signs:**
- Candidates appear in unexpected stages in BambooHR
- Stage names in the BambooHR UI do not match what the YAML says they should be
- BambooHR admin reports deleted or renamed stages

**Phase to address:**
Phase 1 (BambooHR integration) — add startup config validation that verifies stage IDs resolve to expected names before any writes occur.

---

#### Pitfall 3: BambooHR File URL Expiry — PDF Download Fails Silently

**What goes wrong:**
BambooHR attachment URLs are pre-signed, time-limited URLs. They expire — typically within minutes to a few hours of being issued. If the agent fetches the list of candidates, waits or retries, then attempts to download the PDF using a URL fetched earlier in the same run, the download returns HTTP 403 or redirects to an error page. `pdf-parse` then receives HTML error content instead of binary PDF data, produces garbage text or throws, and the CV is either skipped silently or the agent crashes.

**How to avoid:**
Always download the PDF immediately after fetching the application data — never store the URL for later use. Add a check: if the HTTP response for the PDF is not `Content-Type: application/pdf`, log an error and skip that candidate rather than passing HTML or error text to the parser.

**Phase to address:** Phase 2 (PDF parsing and CV extraction).

---

#### Pitfall 4: Image-Only PDFs Return Empty Text — Agent Silently Evaluates Empty CV

**What goes wrong:**
Many candidates scan their CV as an image and export it as PDF. `pdf-parse` does not perform OCR. An image-only PDF returns an empty string. The agent then sends an empty CV text to GPT-4o, which evaluates it as a candidate with no experience and may mark them as rejected with a plausible-sounding comment.

**How to avoid:**
After extraction, check the word count of the extracted text. If fewer than ~50 words are extracted from a PDF larger than ~50KB, treat it as a likely image-only PDF and route to `needsReview`.

**Phase to address:** Phase 2 (PDF parsing).

---

#### Pitfall 5: OpenAI Agent Loop Does Not Terminate — Runaway Token Cost

**What goes wrong:**
Without explicit `maxTurns`, the agent may continue calling tools after it has all the information it needs. With a large backlog, a single run can cost tens of dollars.

**How to avoid:**
Set `maxTurns: 5` explicitly on every `run()` call (already implemented in the codebase). Structure the agent as a per-candidate invocation, not a single agent that iterates all candidates.

**Phase to address:** Phase 3 (Agent orchestration) — already implemented; verify during v1.1 that adding jobs does not relax this constraint.

---

#### Pitfall 6: Timezone Mismatch — Cron Fires at Wrong Time

**What goes wrong:**
macOS crontab uses local system timezone. The Docker container runs with UTC. Moving the cron to an EC2 instance in a different timezone changes when the job fires.

**How to avoid:**
Set `TZ=UTC` in the Dockerfile. Always log timestamps in ISO 8601 UTC. Use `0 11 * * *` in the cron to mean 11:00 UTC (document this explicitly).

**Phase to address:** Phase 4 (Docker + cron wiring) — also relevant to EC2 deployment in v1.1.

---

#### Pitfall 7: Failed Runs Go Unnoticed — Silent Cron Failures

**What goes wrong:**
cron does not alert on non-zero exit codes by default. If the Docker container fails to start (image not found, env vars missing), the recruiter simply does not see new candidates moved.

**How to avoid:**
Redirect both stdout and stderr to a dated log file. The last line of stdout on a successful run is always a JSON summary object. A wrapper script can check for this sentinel line and alert if it is absent.

**Phase to address:** Phase 4 (Docker + cron wiring) — the existing `ScreeningPipeline` already prints the JSON summary on stdout.

---

#### Pitfall 8: GDPR / Data Privacy — CV Text Sent to OpenAI Without Disclosure

**What goes wrong:**
Raw CV text (personal data under GDPR) is sent to OpenAI's API. Without a signed DPA and candidate consent disclosure, this constitutes unlawful processing.

**How to avoid:**
Before enabling `LIVE_MODE=true`: (1) sign OpenAI DPA, (2) add AI processing disclosure to the job application form. This is a pre-deployment legal requirement, not a code task.

**Phase to address:** Phase 1 (project setup) — pre-deployment blocker.

---

#### Pitfall 9: Applicant vs. Application Entity Confusion in BambooHR API

**What goes wrong:**
Developers conflate applicant IDs (person record) with application IDs (job-specific submission). Stage moves, comments, and CV attachments live on the Application entity — using the wrong ID produces silent errors or affects the wrong record.

**How to avoid:**
All BambooHR write operations must use `applicationId`, never `applicantId`. This is enforced in the codebase (Phase 5) but must be verified when adding new write paths in v1.1.

**Phase to address:** Phase 1 and any new write paths.

---

#### Pitfall 10: BambooHR API Rate Limiting — No Retry Logic, Run Crashes

**What goes wrong:**
BambooHR enforces rate limits (documented: 200 requests/minute per API key). With N jobs each with their own candidate batch, multi-job processing makes rate limit violations more likely.

**How to avoid:**
Process candidates sequentially (for-of loop, not Promise.all). Implement exponential backoff retry (3 retries, 1s/2s/4s delays) around every BambooHR API call. With multi-job support, a separate sequential outer loop (job by job) and inner sequential loop (candidate by candidate) keeps the request rate well within limits.

**Phase to address:** Phase 1 — more critical in v1.1 with multi-job.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Global fieldMap not per-job | Simpler schema | Job B's rules silently use Job A's field mappings | Never for multi-job |
| No job-level try/catch in outer loop | Simpler code | One bad job aborts all remaining jobs | Never |
| `user_data_replace_on_change = false` | Avoids instance replacement | Config changes silently don't apply | Never for a config-driven tool |
| Long-lived IAM access keys in CI | Simplest CI setup | Key compromise = full infrastructure access | Never; use OIDC |
| `docker login` once at deploy time | Simple auth flow | Token expires after 12h, unattended pulls fail | Never for persistent EC2 |
| SSH-based EC2 update | Familiar workflow | Port 22 open, key management burden | Never; use pull-on-cron instead |
| Secrets in Terraform variables | Simple interpolation | Values stored in state file in plaintext | Never |
| Only push `latest` tag | Zero extra commands | Rollback requires rebuilding from source | Never |

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|---------------|------------|
| Multi-job schema | MJ-01: Breaking existing config.yaml | z.union to accept both forms; normalize inside loader |
| Multi-job loop | MJ-02: No job-level error isolation | Per-job try/catch mirroring SAFE-01 |
| Multi-job config | MJ-03: Global fieldMap wrong for per-job rules | Move fieldMap inside each job block |
| Multi-job stages | MJ-04: Single validateStages for all jobs | Call validateStages per job inside loop |
| Multi-job runtime | MJ-05: Cron overlap with long batch | Add .lock file guard at run start |
| EC2 user_data | TF-01: Config changes silently don't apply | Set user_data_replace_on_change = true |
| Terraform state | TF-02: Secrets stored in state plaintext | SSM SecureString + S3 encrypted backend |
| IAM role | TF-03: Over-permissioned instance role | Inline policy with exact ARNs and minimal actions |
| ECR auth | TF-04: 12h token expiry breaks unattended pulls | Install amazon-ecr-credential-helper in user_data |
| Security group | TF-05: Port 22 open for SSH | Zero inbound rules; use SSM Sessions for debug access |
| user_data | TF-06: Credentials visible in AWS Console | Fetch from SSM at runtime, never write to disk |
| Deploy script | DS-01: AWS creds not configured, silent fail | sts:get-caller-identity preflight check |
| Deploy script | DS-02: Push to wrong region/account | Derive ECR URL from aws sts + aws configure |
| Deploy script | DS-03: SSH-based EC2 update | Pull-on-cron pattern; no SSH required |
| Deploy script | DS-04: Only latest tag, no rollback | Tag with git SHA + latest on every push |
| Deploy script | DS-05: Credential leak in shell output | Pass values via shell variables, not literals |
| Terraform CI | DS-06: Over-permissioned CI credentials | GitHub Actions OIDC role, no long-lived keys |

---

## Sources

- Terraform AWS provider docs: `user_data_replace_on_change` behavior — https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/instance (HIGH confidence)
- HashiCorp Terraform sensitive data guide — https://developer.hashicorp.com/terraform/language/manage-sensitive-data (HIGH confidence)
- AWS ECR private registry authentication — https://docs.aws.amazon.com/AmazonECR/latest/userguide/registry_auth.html (HIGH confidence)
- Amazon ECR Credential Helper — https://github.com/awslabs/amazon-ecr-credential-helper (HIGH confidence)
- AWS Secrets Manager vs SSM Parameter Store — https://aws.amazon.com/blogs/security/how-to-choose-the-right-aws-service-for-managing-secrets-and-configurations/ (HIGH confidence)
- Terraform S3 backend docs — https://developer.hashicorp.com/terraform/language/backend/s3 (HIGH confidence)
- ECR auth token expiry discussion — https://repost.aws/questions/QUOT8lTHaITkqW0NGB74Pkeg (MEDIUM confidence, community)
- Zod schema docs (union pattern) — https://zod.dev/api (HIGH confidence)
- BambooHR ATS API reference — https://documentation.bamboohr.com/reference (MEDIUM confidence — verify endpoint paths against live docs)

---
*v1.0 pitfalls researched: 2026-05-01*
*v1.1 pitfalls (MJ-01–05, TF-01–06, DS-01–06) researched: 2026-05-04*
