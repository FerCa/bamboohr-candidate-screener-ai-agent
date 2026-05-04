# Technology Stack

**Project:** BambooHR Candidate Screener
**Researched:** 2026-05-04
**Milestone:** v1.1 — Multi-Job & AWS Deployment (addendum to v1.0 stack)

---

## Existing Stack (unchanged from v1.0)

TypeScript 5 / Node.js 22 LTS (ESM, NodeNext), `@openai/agents` SDK, `pdf-parse`, `js-yaml`, `zod`, Docker `node:22-alpine`. No changes needed to these components.

---

## New Stack Decisions for v1.1

### 1. Multi-Job Config — YAML Schema Extension

**Decision: extend `config.yaml` to a `jobs:` array; one config file, N job entries.**

The existing `configSchema` in `src/config/schema.ts` defines a single `job:` object at the root. The minimal change is wrapping that shape in an array:

```yaml
# config.yaml (v1.1)
jobs:
  - openingId: "123"
    stages:
      intake: "New"
      pass: "Schedule Phone Screen"
      fail: "Reviewed"
    hardRules: { ... }
    softRules: { ... }
    fieldMap: { ... }
  - openingId: "456"
    stages: { ... }
    hardRules: { ... }
```

**Node.js iteration pattern:** Load once, validate each entry against the existing `configSchema` (or a new `jobEntrySchema`), then call the existing screener function sequentially for each entry. No parallelism needed — the daily cron budget is generous and sequential processing avoids BambooHR rate limits.

```typescript
// Pseudocode — index.ts
const jobs = loadConfig(); // returns JobConfig[]
for (const job of jobs) {
  await screenJob(job);
}
```

**Zod schema change:** Wrap the existing `configSchema` in `z.array(configSchema)` or rename existing `job:` key to be the inner schema and introduce a `jobs:` root key. The latter is cleaner and preserves backward compatibility via `.optional()` fallback.

**Confidence: HIGH** — straightforward schema refactor, no external dependencies.

---

### 2. Docker Registry — ECR (Private)

**Decision: AWS Elastic Container Registry (ECR), private repository.**

| Criterion | ECR | Docker Hub (Pro) |
|-----------|-----|-----------------|
| Cost | ~$0.10/GB-month storage; pulls from same-region EC2 are free | $5/user/month |
| Auth to EC2 | IAM instance profile — no credentials needed in cron script | Username/token in cron script |
| Network | In-region pull: zero data transfer cost | Egress charges apply |
| Lifecycle policies | Built-in; prevent unbounded image accumulation | Manual tagging required |
| Complexity | Terraform manages the repo alongside the EC2 | Separate account/billing |

**Verdict:** ECR is the right choice when your runtime is EC2 in the same AWS account. The IAM instance profile means the EC2 instance can pull images with no stored credentials. Docker Hub adds per-user cost and requires storing a token on the instance.

**ECR lifecycle policy (required):** Configure a lifecycle rule to keep only the last N images (3 is sufficient for a daily cron). Without it, every push accumulates forever.

**ARM64 note:** If using t4g (Graviton) EC2, the Docker image must be built for `linux/arm64`. Use `docker buildx build --platform linux/arm64` on macOS (requires QEMU via Docker Desktop) or build natively on an ARM64 CI runner. The `node:22-alpine` base image supports both `linux/amd64` and `linux/arm64` — no Dockerfile changes needed, only the build command changes.

**Confidence: HIGH** — ECR + IAM instance profile is the standard AWS pattern, well-documented and widely used.

---

### 3. Terraform — AWS Provider Version

**Decision: hashicorp/aws provider `~> 6.0` (currently at 6.25.x as of late 2025).**

AWS provider v6.0 was released in April 2025 and is now the current major version. v5 is still in security-patch mode. Start new infrastructure on v6 — do not pin to v5 for a greenfield deployment.

**Key v6 change relevant to this project:** Multi-region support via resource-level `region` argument (won't be used here, but good to know). No breaking changes to `aws_instance`, `aws_ecr_repository`, `aws_iam_role`, or `aws_ssm_parameter` resources for the patterns this project uses.

**String-boolean deprecation:** v6 removed support for `"0"`/`"1"` as boolean values in resource attributes. Use `true`/`false` in HCL — this is already the correct practice.

```hcl
# terraform/providers.tf
terraform {
  required_version = ">= 1.7"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
```

**Terraform CLI version:** 1.7+ required for provider-defined functions (used by some AWS modules). Verify with `terraform version`.

**Confidence: HIGH** — version confirmed from GitHub releases page (v6.25.0 released December 2025).

---

### 4. AWS Secrets Management — SSM Parameter Store (SecureString)

**Decision: AWS Systems Manager Parameter Store, SecureString type. NOT Secrets Manager. NOT a `.env` file.**

| Option | Cost | Rotation | Complexity | Verdict |
|--------|------|----------|------------|---------|
| SSM Parameter Store (SecureString) | Free (standard tier) | Manual | Low | **Use this** |
| Secrets Manager | $0.40/secret/month | Automatic | Medium | Overkill for static API keys |
| `.env` file on disk | Free | Manual | Very low | Security risk — file persists on instance |
| Env vars in user_data | Free | Redeploy | None | Exposed in EC2 console/CloudTrail |

**Why SSM Parameter Store wins:**
- Standard-tier parameters are free. Three secrets (BambooHR API key, subdomain, OpenAI API key) cost $0.
- SecureString values are encrypted at rest with KMS (the default AWS-managed key is free).
- EC2 instance retrieves values at container startup via AWS CLI in the cron script — no stored plaintext.
- Terraform provisions the parameters; values are populated manually once (or via Terraform with `sensitive = true`).

**Why not Secrets Manager:** This project has 3 static API keys that never auto-rotate. Paying $1.20/month for rotation capability that won't be used is unnecessary.

**Why not a `.env` file:** A file on the instance survives reboots and is readable by anyone with shell access. It also requires SSH or SSM Session Manager to update — no better than Parameter Store, strictly worse for security.

**Runtime pattern (cron script on EC2):**

```bash
#!/bin/bash
# /home/screener/run.sh — called by crontab
set -e

AWS_REGION="eu-west-1"
ECR_REGISTRY="123456789.dkr.ecr.eu-west-1.amazonaws.com"
IMAGE="${ECR_REGISTRY}/bamboohr-screener:latest"

# Authenticate Docker to ECR (IAM instance profile handles AWS auth)
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Pull latest image
docker pull "$IMAGE"

# Fetch secrets from Parameter Store
BAMBOOHR_API_KEY=$(aws ssm get-parameter \
  --name "/screener/bamboohr-api-key" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text)

BAMBOOHR_SUBDOMAIN=$(aws ssm get-parameter \
  --name "/screener/bamboohr-subdomain" \
  --query "Parameter.Value" \
  --output text)

OPENAI_API_KEY=$(aws ssm get-parameter \
  --name "/screener/openai-api-key" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text)

# Run — secrets injected as env vars, not stored anywhere
docker run --rm \
  -e BAMBOOHR_API_KEY="$BAMBOOHR_API_KEY" \
  -e BAMBOOHR_SUBDOMAIN="$BAMBOOHR_SUBDOMAIN" \
  -e OPENAI_API_KEY="$OPENAI_API_KEY" \
  -e LIVE_MODE=true \
  -v /home/screener/config.yaml:/app/config.yaml:ro \
  "$IMAGE"
```

Secrets are fetched at each cron invocation and never written to disk. The IAM instance profile grants `ssm:GetParameter` and `ecr:GetAuthorizationToken` — no AWS credentials on the instance.

**Confidence: HIGH** — SSM Parameter Store is the standard low-cost secret management pattern for EC2 workloads; pricing confirmed from AWS docs.

---

### 5. EC2 Instance Sizing

**Decision: t4g.micro (ARM64 / Graviton2), Amazon Linux 2023.**

| Instance | vCPU | RAM | On-demand price (us-east-1) | Notes |
|----------|------|-----|----------------------------|-------|
| t4g.nano | 2 | 0.5 GiB | ~$3.07/month | Too tight for Docker daemon + Node.js container |
| **t4g.micro** | **2** | **1 GiB** | **~$6.13/month** | **Recommended — sufficient headroom** |
| t4g.small | 2 | 2 GiB | ~$12.26/month | Unnecessary; 1 GiB is plenty for a short-lived job |
| t3.micro | 2 | 1 GiB | ~$8.35/month | x86 equivalent; 36% more expensive than t4g.micro |

**Why t4g.micro:**
- The screener container runs for ~30-60 seconds once daily, then exits. The instance sits idle the remaining 23.9 hours.
- 1 GiB RAM comfortably accommodates: Docker daemon (~150MB), `node:22-alpine` container (~80MB base + app), Node.js heap for PDF processing.
- t4g is 40% cheaper than t3 for equivalent specs. Graviton2 ARM64 handles Node.js workloads identically.
- Burstable CPU credits: the instance accumulates CPU credits while idle and spends them during the brief daily run — ideal pattern for cron workloads.

**AMI:** Amazon Linux 2023 ARM64 (`al2023-ami-*-arm64`). Docker is installable via `dnf install docker` in user_data. Amazon Linux 2023 ships with AWS CLI v2 pre-installed.

**EBS:** 8GB gp3 root volume is the default and sufficient. Screener downloads PDFs into container memory, not to disk.

**Confidence: HIGH** — pricing from public AWS EC2 pricing page (May 2026); sizing rationale from workload analysis.

---

### 6. Deploy Script Pattern — No Manual SSH

**Decision: local deploy script using `aws ssm send-command` to trigger a re-pull and restart on the EC2 instance. No SSH, no bastion.**

The three-step deploy flow:

```
Step 1: docker buildx build + push to ECR  (local machine)
Step 2: aws ssm send-command → EC2 runs pull + restart script
Step 3: aws ssm get-command-invocation → verify success
```

This requires:
- EC2 instance role has `AmazonSSMManagedInstanceCore` policy.
- SSM Agent installed on instance (included by default on Amazon Linux 2023).
- Local machine has AWS CLI configured with permissions for `ssm:SendCommand`.

**Local deploy script (`scripts/deploy.sh`):**

```bash
#!/bin/bash
set -e

ECR_REGISTRY="123456789.dkr.ecr.eu-west-1.amazonaws.com"
IMAGE_NAME="bamboohr-screener"
INSTANCE_ID="i-0abc123..."  # or read from Terraform output

# Step 1: Build and push
aws ecr get-login-password --region eu-west-1 | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

docker buildx build --platform linux/arm64 \
  -t "$ECR_REGISTRY/$IMAGE_NAME:latest" \
  --push .

# Step 2: Trigger update on EC2
COMMAND_ID=$(aws ssm send-command \
  --instance-ids "$INSTANCE_ID" \
  --document-name "AWS-RunShellScript" \
  --parameters 'commands=["/home/screener/update.sh"]' \
  --query "Command.CommandId" \
  --output text)

# Step 3: Wait and verify
aws ssm wait command-executed \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID"

aws ssm get-command-invocation \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query "Status" \
  --output text
```

The `update.sh` on the EC2 instance simply pulls the new image. The cron scheduler picks up the new image on the next scheduled run — no container restart needed since the container is short-lived and already done.

**Confidence: MEDIUM** — SSM send-command pattern is well-documented; specific `wait` command syntax should be verified against current AWS CLI docs.

---

### 7. Terraform Resource Map

Minimum required resources for this workload:

| Resource | Terraform Type | Notes |
|----------|---------------|-------|
| ECR repository | `aws_ecr_repository` | `image_tag_mutability = "MUTABLE"` (overwrite `:latest` on each push) |
| ECR lifecycle policy | `aws_ecr_lifecycle_policy` | Keep last 3 images |
| EC2 instance | `aws_instance` | t4g.micro, Amazon Linux 2023 ARM64 |
| IAM role | `aws_iam_role` | EC2 assume-role principal |
| IAM instance profile | `aws_iam_instance_profile` | Attaches role to EC2 |
| IAM policy | `aws_iam_role_policy` or `aws_iam_policy` | Grants ECR pull + SSM get-parameter + SSM managed instance core |
| SSM parameters | `aws_ssm_parameter` | Type = `SecureString` for API keys; `String` for subdomain |
| Security group | `aws_security_group` | Egress only (HTTPS to ECR, BambooHR API, OpenAI API); no inbound needed |
| Key pair | `aws_key_pair` | Optional — SSM Session Manager eliminates SSH need |
| VPC/Subnet | Use default VPC | Acceptable for this workload; a custom VPC is overkill |

**No load balancer, no RDS, no ECS.** This is a single EC2 instance running cron — keep it simple.

**Terraform state:** Remote state in S3 + DynamoDB locking is the standard. For a single-developer project, local state is acceptable if the risk of state loss is acknowledged. S3 backend setup adds ~3 resources but protects against accidental state deletion.

**Confidence: HIGH** — resource list derived from the workload requirements; all resource types are stable in AWS provider v6.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Registry | AWS ECR | Docker Hub | No free private repos; token management on EC2; more expensive |
| Registry | AWS ECR | GitHub Container Registry | Adds GitHub dependency; ECR keeps everything in AWS account |
| Secrets | SSM Parameter Store | Secrets Manager | $0.40/secret/month for static API keys that don't rotate — unnecessary cost |
| Secrets | SSM Parameter Store | `.env` file on disk | Persists plaintext on instance; harder to rotate; security anti-pattern |
| Instance type | t4g.micro | t3.micro | 36% more expensive for identical specs; ARM64 fully supported by Node.js + Alpine |
| Instance type | t4g.micro | Fargate/ECS | Significant additional complexity for a single daily cron job; overkill |
| Deploy trigger | SSM send-command | GitHub Actions | Adds CI/CD platform dependency; SSM send-command works from any machine with AWS CLI |
| Deploy trigger | SSM send-command | CodeDeploy | CodeDeploy adds an agent, deployment groups, appspec.yaml — too much ceremony for this use case |
| Scheduling | EC2 crontab | EventBridge + Lambda | Lambda cold start + ECR pull latency; more moving parts; EC2 cron is simpler and free |
| Scheduling | EC2 crontab | ECS Scheduled Tasks | ECS cluster adds cost; Fargate per-invocation billing adds up; EC2 cron is free |
| Terraform state | Local | S3 + DynamoDB | S3 backend is best practice for teams; local state is acceptable for single-developer, acknowledged risk |
| Provider version | `~> 6.0` | `~> 5.0` | v5 is in security-patch mode; start new infra on current major version |

---

## Installation

```bash
# No new Node.js packages needed for multi-job support
# The config schema change is pure TypeScript refactoring

# Terraform setup (one-time)
brew install terraform  # or use tfenv for version management
terraform init          # in terraform/ directory

# AWS CLI setup (one-time)
brew install awscli
aws configure  # or use AWS SSO
```

---

## Sources

- AWS ECR pricing: https://aws.amazon.com/ecr/pricing/ — HIGH confidence
- t4g.micro pricing (~$6.13/month, us-east-1): https://www.economize.cloud/resources/aws/pricing/ec2/t4g.micro/ — HIGH confidence
- Terraform AWS provider v6.0 release: https://www.hashicorp.com/en/blog/terraform-aws-provider-6-0-now-generally-available — HIGH confidence
- Terraform AWS provider v6.25.0 (latest as of Dec 2025): https://github.com/hashicorp/terraform-provider-aws/releases/tag/v6.25.0 — HIGH confidence
- AWS SSM Parameter Store pricing (standard = free): https://aws.amazon.com/blogs/security/how-to-choose-the-right-aws-service-for-managing-secrets-and-configurations/ — HIGH confidence
- SSM send-command deploy pattern: https://medium.com/@usvisen2000/simplifying-docker-deployments-on-aws-ec2-instances-a-github-actions-and-aws-ssm-approach-45014bf3869a — MEDIUM confidence
- Docker multi-platform ARM64 builds: https://docs.docker.com/build/building/multi-platform/ — HIGH confidence
- node:22-alpine ARM64 support: https://github.com/nodejs/docker-node — HIGH confidence

---

*Stack research addendum for: BambooHR candidate screener v1.1 (Multi-Job & AWS Deployment)*
*Researched: 2026-05-04*
