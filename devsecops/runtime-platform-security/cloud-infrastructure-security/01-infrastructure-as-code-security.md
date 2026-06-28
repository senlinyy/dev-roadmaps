---
title: "Infrastructure as Code Security"
description: "Review Terraform, OpenTofu, modules, secrets, plans, and provider policy checks before cloud APIs create risky infrastructure."
overview: "Start with one tiny Terraform resource, then follow a customer portal change through plan review, IaC scanning, secret checks, module and provider version review, cloud provider policy checks, and pull request feedback that catches risky infrastructure before apply."
tags: ["devsecops", "iac", "terraform", "scanning"]
order: 1
id: article-devsecops-cloud-infrastructure-security-iac-security-scanning
---

## Table of Contents

1. [Cloud Resources Are Edited Like Code](#cloud-resources-are-edited-like-code)
2. [The Small Terraform Resource](#the-small-terraform-resource)
3. [The Production Change We Will Review](#the-production-change-we-will-review)
4. [Plan Review Before Apply](#plan-review-before-apply)
5. [Scanning Terraform and OpenTofu](#scanning-terraform-and-opentofu)
6. [Secrets, Modules, and Versions](#secrets-modules-and-versions)
7. [Provider Policy Checks](#provider-policy-checks)
8. [Pull Request Feedback That Engineers Can Use](#pull-request-feedback-that-engineers-can-use)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Cloud Resources Are Edited Like Code
<!-- section-summary: IaC security treats cloud changes as reviewed code before cloud APIs create or modify resources. -->

Cloud resources are now edited like code. A storage bucket, database subnet, security group, IAM role, queue, DNS record, and Kubernetes cluster can all start as a file in a repository. An engineer opens a pull request, reviewers inspect the change, automation runs checks, and a deployment role calls the cloud API after approval.

**Infrastructure as Code**, usually shortened to **IaC**, means a team describes infrastructure in files instead of relying on manual console clicks. Terraform and OpenTofu use HCL files. AWS CloudFormation uses YAML or JSON. Azure Bicep uses Bicep files. Pulumi can use general programming languages. The syntax changes across tools, but the security question stays steady: what will this file create, expose, delete, or grant when the cloud provider receives the API call?

That last part is the important beginner idea. An IaC file is not a drawing. It can create a real public bucket, open a real database port, attach a real IAM policy, or remove a real network rule. The safe review moment sits before `apply`, while the change is still a pull request and the author can fix a few lines.

For this article, we will follow the Northstar customer portal. Customers sign in, pay invoices, and download receipt PDFs. The team uses Terraform or OpenTofu to manage the cloud infrastructure behind that portal. We will start with one tiny resource, then widen the review until it looks like a production workflow.

## The Small Terraform Resource
<!-- section-summary: A tiny resource block gives beginners a concrete shape before scanners, plans, and policies appear. -->

A Terraform or OpenTofu **resource block** tells the IaC tool to manage one cloud object. Here is a very small AWS S3 bucket resource:

```hcl
resource "aws_s3_bucket" "receipts" {
  bucket = "northstar-payment-receipts-prod"
}
```

The word `resource` starts a managed object. `aws_s3_bucket` is the provider resource type, so Terraform knows this object is an S3 bucket. `receipts` is the local name used inside the Terraform code. The `bucket` field is the actual bucket name that AWS will see.

This tiny block looks harmless. It also leaves out security choices. It does not say whether public access is blocked. It does not show encryption, logging, object retention, lifecycle rules, tags, or who may read and write receipt files. Many real pull requests begin this way: a small resource appears first, then surrounding security settings arrive later or get forgotten.

The first review habit is simple. When a resource stores customer data, the reviewer asks for the resource plus the controls that make it safe. For a receipt bucket, that usually means public access blocking, encryption, ownership, logging or event evidence, lifecycle and retention choices, and a narrow IAM policy for the workload that writes receipts.

![IaC review funnel showing pull request code becoming plan JSON, IaC scans, secrets scans, provider checks, and controlled apply with reach, access, and data questions](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/iac-review-funnel.png)

*The funnel shows how a pull request turns into plan data, automated checks, and a controlled apply instead of a direct jump from code to cloud APIs.*

Now we can place that tiny bucket inside a real production change.

## The Production Change We Will Review
<!-- section-summary: One customer portal change gives plan review, scanning, IAM review, and provider checks a concrete place to land. -->

The Northstar team is adding downloadable payment receipts. The feature needs three infrastructure pieces: an object storage bucket for PDFs, a private database rule for the application, and a worker role that writes receipt files after payments settle.

The first pull request creates all three pieces. That is common in production work. A product feature often touches storage, networking, and identity at the same time. It also means one unsafe default can cross several boundaries at once.

Here is a risky first draft. It is short enough to read, and it carries three security problems that appear in real infrastructure reviews:

```hcl
resource "aws_s3_bucket" "receipts" {
  bucket = "northstar-payment-receipts-prod"
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}

resource "aws_security_group" "database" {
  name   = "portal-database"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port   = 5432
    to_port     = 5432
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_iam_role_policy" "worker_receipts" {
  name = "worker-receipts"
  role = aws_iam_role.worker.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "s3:*"
        Resource = "*"
      }
    ]
  })
}
```

The public access block resource disables all four bucket protections. The database security group allows PostgreSQL from the whole internet. The worker policy grants every S3 action on every bucket. A careful reviewer can spot those problems in this small example, but production pull requests often contain modules, variables, conditionals, generated plans, and hundreds of lines.

That is where IaC security starts to earn its place. The team uses the plan to see the actual intended cloud change, scanners to catch common risky patterns, secret checks to protect credentials, module and version review to control reused infrastructure, provider-native checks to catch cloud-specific policy errors, and pull request feedback to send the author toward a fix.

## Plan Review Before Apply
<!-- section-summary: A plan previews the cloud changes before the deployment role applies them. -->

An **IaC plan** is a preview of intended cloud changes. For a beginner, think of it as the receipt before checkout: this bucket will be created, this rule will open port `5432`, and this role will receive these actions. Security review should happen while the plan is still a pull request.

Terraform and OpenTofu compare the configuration files with state and live cloud data, then show which resources they intend to create, update, replace, or delete. The plan is useful because modules, variables, provider defaults, and existing state can make the final change different from what a reviewer guessed from one file.

A pull request job can create a saved plan and a JSON version:

```bash
terraform init -backend=false
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
```

`terraform init -backend=false` prepares providers and modules without connecting to a remote state backend for this basic validation path. `terraform fmt -check` verifies formatting. `terraform validate` checks syntax and references. `terraform plan -out=tfplan` saves the preview to a file. `terraform show -json tfplan` converts that plan into structured JSON for scanners and policy tools.

OpenTofu follows the same workflow shape:

```bash
tofu init -backend=false
tofu fmt -check
tofu validate
tofu plan -out=tfplan
tofu show -json tfplan > tfplan.json
```

The plan review should start with the highest-risk changes. Storage resources need public access, encryption, logging, retention, and data classification review. Network resources need inbound sources, outbound paths, public IPs, route tables, load balancer exposure, and private endpoint review. IAM resources need actions, resources, trust policies, permission boundaries, role passing, and wildcard review. Databases need network placement, encryption, backups, deletion protection, and authentication review.

The plan can also show accidental blast radius. A pull request titled "add receipt storage" should not destroy a production subnet, replace a database, or remove a key. A reviewer who sees `-/+` replacement or `- destroy` in the plan can ask why the change needs that scope before the cloud provider receives the call.

The plan gives the team the intended cloud diff. The next layer checks whether that diff violates known risky patterns.

## Scanning Terraform and OpenTofu
<!-- section-summary: IaC scanners inspect configuration and plan data for common misconfigurations before apply. -->

An **IaC scanner** is a tool that reads infrastructure files or plan JSON and compares them with security rules. The rule may say storage buckets should block public access, security groups should avoid database ports from the internet, disks should use encryption, Kubernetes pods should avoid privileged mode, or IAM policies should avoid wildcard admin access.

Scanners help human reviewers by handling repetitive checks. A person still reviews intent, architecture, exceptions, and ownership. The scanner handles the common patterns every time a pull request runs.

The Northstar team can scan both source files and the generated plan:

```bash
checkov -d .
checkov -f tfplan.json
```

`checkov -d .` scans the current directory of IaC files. `checkov -f tfplan.json` scans the resolved plan, including values that come from modules and variables. Source scans catch risky code early. Plan scans catch the actual proposed resource values.

Other teams may use different scanners. `tfsec` is a Terraform-focused scanner. Terrascan supports multiple IaC formats and policy packs:

```bash
tfsec .
terrascan scan -t terraform -i terraform
```

For the risky Northstar draft, useful scanner feedback should name the resource, explain the risk, and point toward the safe shape:

```bash
Infrastructure security checks failed

HIGH  aws_security_group.database
      PostgreSQL ingress allows 0.0.0.0/0.
      Expected: allow port 5432 only from the application security group or an approved private CIDR.

HIGH  aws_s3_bucket_public_access_block.receipts
      Public access protections are disabled for a bucket that stores receipts.
      Expected: enable all four public access block settings.

HIGH  aws_iam_role_policy.worker_receipts
      IAM policy allows s3:* on *.
      Expected: grant only the receipt bucket actions the worker needs.
```

That output is useful because the author can open the exact resource and fix the intent. A finding that only says "rule failed" creates extra work and teaches engineers to distrust the gate.

![Risky versus safer Terraform comparison showing public storage, open database ingress, and admin IAM replaced with private access and scoped permissions](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/risky-vs-safer-terraform.png)

*This comparison turns the scanner findings into the concrete design shift: public paths and wildcard permissions move toward private paths and scoped roles.*

Here is the safer version of the same Northstar intent:

```hcl
resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_security_group_rule" "database_from_app" {
  type                     = "ingress"
  security_group_id        = aws_security_group.database.id
  from_port                = 5432
  to_port                  = 5432
  protocol                 = "tcp"
  source_security_group_id = aws_security_group.app.id
}
```

The four public access flags block public ACLs and public bucket policies. The encryption configuration asks AWS to use KMS for objects written to the bucket. The security group rule accepts PostgreSQL traffic from the application security group, which gives the application tier a path to the database without opening the database to the internet.

The worker policy should also narrow its S3 access:

```hcl
data "aws_iam_policy_document" "worker_receipts" {
  statement {
    sid     = "ListReceiptBucket"
    effect  = "Allow"
    actions = ["s3:ListBucket"]

    resources = [
      aws_s3_bucket.receipts.arn
    ]
  }

  statement {
    sid    = "ReadAndWriteReceipts"
    effect = "Allow"

    actions = [
      "s3:GetObject",
      "s3:PutObject"
    ]

    resources = [
      "${aws_s3_bucket.receipts.arn}/receipts/*"
    ]
  }
}
```

S3 bucket-level actions use the bucket ARN. Object-level actions use the object ARN with a path. This split is easy to miss in a broad `s3:*` policy, so the scanner finding turns into a stronger design and a clearer code review.

The main resource risk is now visible. The next set of problems can hide in values and reused code around the resource blocks.

## Secrets, Modules, and Versions
<!-- section-summary: IaC review includes credentials, reusable modules, and provider versions around the resource code. -->

A **secret** is a value that grants access or proves identity. Cloud access keys, database passwords, API tokens, private keys, webhook secrets, and OAuth client secrets all fit this category. IaC often sits near secrets because infrastructure needs provider credentials, database credentials, bootstrap tokens, and integration values.

The safe repository pattern is to keep secret values out of Git. The code can define variable names and validation rules. Runtime systems such as secret managers, CI secret stores, or cloud-native secret services provide the actual value during an approved run.

```hcl
variable "database_password" {
  type      = string
  sensitive = true
}
```

`type = string` tells Terraform the variable expects text. `sensitive = true` asks Terraform to hide the value in CLI output and state display. It does not protect a real password committed into the repository. Git history, forks, build logs, and local clones can still carry the leaked value.

A pull request should run a secret scan:

```bash
gitleaks detect --source . --redact
```

`--source .` scans the current repository path. `--redact` keeps detected secret values out of the command output. When a real credential appears, the fix has two parts: remove the value from code and rotate the credential. A cleaned-up latest commit does not erase old copies that already spread through clones or logs.

IaC also uses **modules**. A module is a reusable package of infrastructure code. A storage module might create a bucket, encryption, public access blocks, logging, lifecycle rules, and IAM policies together. Modules help teams reuse safe patterns, and they also move security decisions into shared code.

Production module sources should use explicit versions or immutable references:

```hcl
module "receipt_storage" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "4.1.2"

  bucket = "northstar-payment-receipts-prod"
}
```

`source` tells Terraform where to find the module. `version` pins the registry module release. Without a version pin, the module can change under the caller and bring new defaults, resource replacements, or access changes into the next plan.

Provider versions need the same attention. The `.terraform.lock.hcl` file records provider versions and checksums. A provider upgrade can add new fields, deprecate old ones, change default behavior, or alter replacement rules. A pull request that changes the lock file should explain the provider change and show the plan impact.

At this point, the repository checks cover resource shape, secrets, modules, and versions. The cloud provider can add another layer because it understands its own IAM language and organization rules.

## Provider Policy Checks
<!-- section-summary: Provider-native checks catch cloud-specific IAM and governance problems alongside IaC scanner output. -->

**Provider policy checks** are evaluations from the cloud platform or cloud governance layer. An IaC scanner reads files and plans. A provider policy system understands the provider's own resource model, IAM language, organization hierarchy, and sometimes live account context.

For AWS IAM policies, Northstar can run IAM Access Analyzer policy validation before attaching the worker policy:

```bash
aws accessanalyzer validate-policy \
  --policy-document file://worker-receipts-policy.json \
  --policy-type IDENTITY_POLICY
```

`--policy-document` points to the JSON policy file. `--policy-type IDENTITY_POLICY` tells Access Analyzer that the policy will attach to an identity such as a role. The result can include errors, security warnings, and suggestions related to actions, resources, conditions, and policy structure.

Azure teams often combine IaC review with **Azure Policy**. Azure Policy can audit or deny deployments based on rules such as allowed locations, required tags, public network access, private endpoint requirements, and encryption settings. Teams commonly keep policy definitions and assignments in Git so governance changes receive review too.

Google Cloud teams use **Organization Policy Service** to set constraints across folders and projects. A platform team can restrict external IP use, limit allowed regions, control service account key creation, or constrain resource sharing patterns.

These cloud-side checks protect more than one repository. If one CI job is misconfigured, an organization-level guardrail can still deny a dangerous request at the provider. The strongest production setup usually layers repository checks, managed policy checks, and provider-side guardrails.

The last step is turning all this review into feedback the author can use without reading raw plan JSON for an hour.

## Pull Request Feedback That Engineers Can Use
<!-- section-summary: A useful IaC gate is strict on high-risk findings and clear about the next safe edit. -->

A **pull request gate** is a CI check that must pass before a change can merge. For IaC security, the gate should block high-risk findings and explain the fix path in plain language. If the report produces hundreds of noisy warnings, engineers stop trusting it. If it silently passes public data paths or broad IAM, it gives false confidence.

Northstar can run the gate in layers:

```bash
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json

checkov -d .
checkov -f tfplan.json
gitleaks detect --source . --redact
```

The first group checks formatting, syntax, references, and the planned cloud change. The second group scans source, plan data, and secrets. Provider-specific checks such as IAM Access Analyzer can run after the policy document is rendered.

A helpful pull request comment for the risky draft could look like this:

```markdown
### Infrastructure security gate failed

This pull request creates or changes 7 resources.

Blocking findings:

- `aws_security_group.database`: PostgreSQL is open to `0.0.0.0/0`. Limit ingress to the application security group or an approved private CIDR.
- `aws_s3_bucket_public_access_block.receipts`: Public access protections are disabled for the receipts bucket. Enable all four public access block settings.
- `aws_iam_role_policy.worker_receipts`: Worker role grants `s3:*` on `*`. Scope actions to receipt bucket reads and writes.

Review warnings:

- `module.receipt_storage`: Module version changed from `4.0.1` to `4.1.2`. Confirm the changelog and replacement behavior.
- `terraform plan`: No deletes detected.
```

The report separates blocking findings from review warnings. A public database path should stop the merge. A module version update may need human review, especially in production. The author receives a short list with resources, reasons, and expected direction.

CI credentials need the same discipline as the code. The workflow that creates a pull request plan should use read-limited or plan-limited access where possible. The workflow that applies production changes should run from a protected branch or protected environment, use a separate deployment role, and require approval. A pull request from an untrusted fork should not receive production cloud credentials just to run checks.

## Putting It All Together
<!-- section-summary: IaC security catches risky design while the infrastructure change is still reviewable code. -->

The Northstar release starts with a simple feature request: customers need downloadable receipt PDFs. The first Terraform draft creates a bucket, a database network path, and a worker role. Without IaC security, the deployment role could create public storage posture, internet-facing database access, and broad S3 permissions in production.

With IaC security, the change follows a review path. The author opens a pull request. CI formats and validates the code. Terraform or OpenTofu creates a plan and JSON plan output. Checkov, tfsec, or Terrascan scans the configuration and plan. Gitleaks checks for committed credentials. Module and provider version changes appear in the diff. AWS IAM Access Analyzer validates the worker policy. Azure Policy or Google Cloud Organization Policy can still enforce provider-side governance where those platforms are used.

The safer Terraform version then replaces the risky draft. The bucket blocks public access and uses server-side encryption. The database accepts traffic from the application tier. The worker role receives only the S3 actions it needs on the receipt prefix. The pull request records the module version reason, and the CI comment gives reviewers a short action list.

The practical value is timing. The team finds risky cloud design before the API call, before customer data lands in the bucket, and before a database port is exposed. The fix is still a code review, not an incident.

![IaC security summary showing plan review, IaC scans, secrets checks, module review, provider policy, pull request feedback, and controlled apply](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/iac-security-summary.png)

*The summary shows the full Northstar PR review path: plan, scan, secrets, modules, provider policy, and a safer apply at the end.*

## What's Next

IaC security gives Northstar the first review layer around infrastructure files and plans. Some review rules repeat in every pull request: production databases stay private, customer data buckets block public access, required tags identify owners, and exceptions expire.

The next article turns those repeated rules into **Policy as Code**. The team will write versioned, testable rules that read the plan, produce clear deny messages, and create evidence for pull request and managed deployment gates.

## References

- [Terraform resources language documentation](https://developer.hashicorp.com/terraform/language/resources) - Official Terraform documentation for declaring managed infrastructure objects.
- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - Official Terraform documentation for creating and reviewing execution plans.
- [Terraform show command](https://developer.hashicorp.com/terraform/cli/commands/show) - Official Terraform documentation for inspecting saved plans and producing JSON output.
- [Terraform dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - Official Terraform documentation for provider lock files and checksums.
- [OpenTofu resources language documentation](https://opentofu.org/docs/language/resources/) - Official OpenTofu documentation for declaring managed resources.
- [OpenTofu plan command](https://opentofu.org/docs/cli/commands/plan/) - Official OpenTofu documentation for previewing infrastructure changes.
- [Checkov CLI command reference](https://www.checkov.io/2.Basics/CLI%20Command%20Reference.html) - Official Checkov documentation for scanning IaC files and plan output.
- [tfsec documentation](https://aquasecurity.github.io/tfsec/) - Official tfsec documentation for Terraform security scanning.
- [Terrascan documentation](https://runterrascan.io/docs/) - Official Terrascan documentation for scanning infrastructure as code.
- [Gitleaks documentation](https://github.com/gitleaks/gitleaks) - Official Gitleaks project documentation for detecting hardcoded secrets in repositories.
- [AWS IAM Access Analyzer policy validation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-validation.html) - Official AWS documentation for validating IAM policies.
- [Azure Policy as Code](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-as-code) - Official Microsoft guidance for managing Azure Policy definitions and assignments through code workflows.
- [Google Cloud Organization Policy Service](https://cloud.google.com/resource-manager/docs/organization-policy/overview) - Official Google Cloud documentation for organization-wide resource constraints.
- [NIST Secure Software Development Framework SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST guidance for secure software development practices and automated security checks.
