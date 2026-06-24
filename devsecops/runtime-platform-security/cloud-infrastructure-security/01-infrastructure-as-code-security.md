---
title: "Infrastructure as Code Security"
description: "Scan Terraform, OpenTofu, and other infrastructure code for risky configuration before cloud APIs apply it."
overview: "Infrastructure as Code security reviews Terraform, OpenTofu, modules, secrets, plans, and policy checks before cloud APIs create risky storage, networking, and IAM resources."
tags: ["devsecops", "iac", "terraform", "scanning"]
order: 1
id: article-devsecops-cloud-infrastructure-security-iac-security-scanning
---

## Table of Contents

1. [What Infrastructure as Code Security Protects](#what-infrastructure-as-code-security-protects)
2. [The Production Scenario](#the-production-scenario)
3. [Plan Review Before Apply](#plan-review-before-apply)
4. [Scanning Terraform and OpenTofu](#scanning-terraform-and-opentofu)
5. [Secrets, Modules, and Versions](#secrets-modules-and-versions)
6. [Provider Policy Checks](#provider-policy-checks)
7. [Pull Request Feedback That Engineers Can Use](#pull-request-feedback-that-engineers-can-use)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Infrastructure as Code Security Protects
<!-- section-summary: Infrastructure as Code security catches risky cloud resources while they are still pull request changes. -->

**Infrastructure as Code**, usually shortened to **IaC**, means cloud infrastructure lives in files. Instead of clicking through a console to create a bucket, subnet, firewall rule, database, or IAM role, the team describes those resources in Terraform, OpenTofu, CloudFormation, Bicep, Pulumi, or another tool. The IaC tool reads the files, compares them with the real cloud account, and calls cloud APIs to create, update, or delete resources.

That API part matters for security. A Terraform file can create an internet-facing database. It can attach `AdministratorAccess` to a workload role. It can turn off S3 public access blocking. It can open a storage account to anonymous reads. The cloud provider will happily create those resources if the caller has permission, so the best review moment comes **before apply**, while the change is still code.

The first security habit is treating infrastructure changes like application changes. A pull request should answer a few plain questions: what resources will be created, who can reach them, who can use them, what data can they hold, what secrets are involved, and which guardrails will stop the dangerous cases. The answer should come from the code, the plan output, scanners, provider policy tools, and human review together.

This article follows one team through that process. The team uses Terraform or OpenTofu, and the same ideas apply to other IaC tools. The exact syntax changes, while the security questions stay very similar.

![IaC review funnel showing pull request code becoming plan JSON, IaC scans, secrets scans, provider checks, and controlled apply with reach, access, and data questions](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/iac-review-funnel.png)

*The funnel shows how a pull request turns into plan data, automated checks, and a controlled apply instead of a direct jump from code to cloud APIs.*

## The Production Scenario
<!-- section-summary: A small payments portal gives us a concrete path through storage, networking, IAM, scanners, secrets, and CI feedback. -->

Picture a small team building the **Northstar customer portal**. Customers sign in, pay invoices, and download receipts. The next release adds three pieces of infrastructure: an object storage bucket for PDF receipts, a private database subnet and security group, and an IAM role for a background worker that writes receipt files after payments settle.

The team wants to ship quickly, so they put the infrastructure in a Terraform module and open a pull request. The files create storage, networking, and IAM in one change. That is normal in production work because one feature often needs several cloud resources at once. It also means one mistake can cross several security boundaries at once.

Here is a risky first draft. The snippet is intentionally small, but it shows three problems that appear in real pull requests: public storage posture, public database reachability, and broad IAM permissions.

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

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
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

The storage bucket may hold payment receipts, which can contain customer names, invoice numbers, addresses, or tax details. The database security group allows PostgreSQL from the whole internet. The worker role can perform every S3 action on every bucket in the account. A reviewer can spot these issues by reading the code, but production teams need automation because reviewers get tired and pull requests get large.

The first automated review comes from the IaC plan.

## Plan Review Before Apply
<!-- section-summary: A plan shows the real resource changes the IaC tool intends to send to cloud APIs. -->

A **plan** is the IaC tool's preview of the changes it intends to make. Terraform and OpenTofu compare the current state with the configuration files, then show which resources they will create, update, replace, or delete. The plan is important because variables, modules, defaults, provider behavior, and existing state can turn a small code change into a larger cloud change.

For the Northstar team, the pull request includes a Terraform module. A reviewer should not read only `main.tf` and guess the result. The CI job can produce a saved plan and a machine-readable JSON version for scanners and review tooling.

```bash
terraform init -backend=false
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
```

OpenTofu uses the same workflow shape with `tofu`:

```bash
tofu init -backend=false
tofu fmt -check
tofu validate
tofu plan -out=tfplan
tofu show -json tfplan > tfplan.json
```

`fmt` checks that the files use the standard format, which keeps reviews focused on behavior instead of whitespace. `validate` checks syntax and internal references. `plan` shows the intended changes. `show -json` turns the saved plan into structured data so a scanner can inspect the actual planned resources, including values that come from variables and modules.

Plan review should focus on security-sensitive changes first. Storage resources need public access, encryption, retention, and logging review. Networking resources need inbound sources, outbound paths, public IPs, load balancer exposure, and route table changes review. IAM resources need actions, resources, trust policies, permission boundaries, and wildcard use review. Databases need network placement, encryption, backups, deletion protection, and authentication review.

The plan also catches accidental deletes. A pull request that says "add receipt storage" should not replace the production database subnet or destroy a key. A reviewer who sees `-/+` replacement or `- destroy` in the plan can ask why the change needs that blast radius before the cloud provider receives the API call.

Plan review gives the team the intended cloud diff. The next layer asks whether that diff violates known security rules.

## Scanning Terraform and OpenTofu
<!-- section-summary: IaC scanners inspect configuration and plan output for risky patterns that reviewers often miss. -->

An **IaC scanner** is a tool that reads infrastructure files or plan JSON and compares them against security rules. The rule might say "storage buckets should block public access," "security groups should not expose databases to the internet," "KMS encryption should be enabled," or "IAM policies should avoid wildcard actions." Scanners make common risky patterns visible every time, and human review still handles intent, exceptions, and design tradeoffs.

Checkov, tfsec, and Terrascan are common examples in Terraform and OpenTofu workflows. A team usually picks one scanner first, tunes its output, and adds exceptions only when the reason is specific and documented. Running three scanners forever can create noisy duplicate findings, so the better practice is choosing a main scanner and adding focused checks where another tool gives useful coverage.

The Northstar CI job can scan both the source directory and the plan JSON:

```bash
checkov -d .
checkov -f tfplan.json
```

Some teams prefer tfsec for fast Terraform-focused feedback:

```bash
tfsec .
```

Terrascan can fit teams that want policy packs across multiple IaC formats:

```bash
terrascan scan -t terraform -i terraform
```

The source scan finds risky code patterns before variables resolve. The plan scan sees the final planned values after modules and variable files are applied. That distinction helps in real work. A module might hide a permissive default, while the plan shows the resource that will actually be created.

For the risky Northstar snippet, useful scanner feedback should say something close to this:

```bash
Infrastructure security checks failed

HIGH  aws_security_group.database
      PostgreSQL ingress allows 0.0.0.0/0.
      Expected: allow port 5432 only from the application security group or a private CIDR.

HIGH  aws_s3_bucket_public_access_block.receipts
      Public access block settings are disabled for a bucket that stores receipts.
      Expected: block public ACLs and public bucket policies.

HIGH  aws_iam_role_policy.worker_receipts
      IAM policy allows s3:* on *.
      Expected: grant only the bucket and object actions the worker needs.
```

That output is useful because it names the resource, the risk, and the expected direction. A scanner report that only says "failed rule 123" sends engineers into a search tab. A good PR gate should help the author fix the change while the code is fresh in their head.

![Risky versus safer Terraform comparison showing public storage, open database ingress, and admin IAM replaced with private access and scoped permissions](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/risky-vs-safer-terraform.png)

*This comparison turns the scanner findings into the concrete design shift: public paths and wildcard permissions move toward private paths and scoped roles.*

Here is a safer version of the same intent. The database accepts traffic from the application security group, the bucket blocks public access and enables encryption, and the worker policy scopes access to the receipt bucket.

```hcl
resource "aws_s3_bucket" "receipts" {
  bucket = "northstar-payment-receipts-prod"
}

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

resource "aws_security_group" "database" {
  name   = "portal-database"
  vpc_id = aws_vpc.main.id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

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
      "${aws_s3_bucket.receipts.arn}/*"
    ]
  }
}

resource "aws_iam_role_policy" "worker_receipts" {
  name   = "worker-receipts"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_receipts.json
}
```

This version still needs review. For example, the team may require a customer-managed KMS key, bucket versioning, object retention, access logging, or VPC endpoints for private S3 access. The important shift is that the most obvious public exposure and wildcard permissions disappear before the pull request merges.

Security scanning catches many cloud misconfigurations. The next problems hide around the IaC files: secrets, modules, and dependency versions.

## Secrets, Modules, and Versions
<!-- section-summary: IaC review includes the values and dependencies around the resources, not only the resource blocks themselves. -->

A **secret** is a value that grants access or proves identity. Cloud access keys, database passwords, API tokens, private keys, webhook secrets, and OAuth client secrets all belong in this category. IaC files often sit close to secret values because infrastructure needs credentials for databases, providers, integrations, and bootstrap jobs. That closeness creates a simple mistake: someone pastes a real secret into `terraform.tfvars`, commits it, and now the secret lives in Git history.

The Northstar team should keep secret values in a secret manager or CI secret store, then pass them into Terraform or OpenTofu at runtime. The repository can hold variable names, types, validation rules, and examples with fake values. Production secrets belong outside the repository.

```hcl
variable "database_password" {
  type      = string
  sensitive = true
}
```

The `sensitive = true` flag helps Terraform hide the value in CLI output. Git still stores any secret that appears in the file itself. A secrets scan should run on every pull request, and the scanner should redact the value in logs.

```bash
gitleaks detect --source . --redact
```

When a secret scan finds a real credential, the fix has two parts. First, remove the value from the code path and replace it with a runtime secret reference. Second, rotate the exposed credential because the old value may already exist in clones, caches, build logs, or forks. The latest commit can look clean while older copies still contain the exposed value.

IaC also uses **modules**. A module is a reusable package of infrastructure code. A storage module might create a bucket, encryption settings, logging, lifecycle rules, and policies together. Modules help teams reuse good patterns. They also move security decisions into someone else's code.

Version review matters here. A module source that follows a branch like `main` can change under the team without a pull request in the application repo. A module with no version pin can pull in a new default that opens access, removes logging, changes encryption, or replaces a resource. Production modules should use explicit versions or immutable Git references.

```hcl
module "receipt_storage" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "4.1.2"

  bucket = "northstar-payment-receipts-prod"
}
```

A good module review asks practical questions. Who maintains the module? Does the module expose security settings as variables with safe defaults? Are public access settings, encryption, logging, and deletion protection visible to the caller? Does the module version include breaking changes? Does the lock file show provider upgrades that deserve extra review?

The `.terraform.lock.hcl` file records provider versions and checksums. Reviewers should treat provider changes as meaningful infrastructure changes because providers decide how Terraform talks to cloud APIs. A provider upgrade can introduce new defaults, deprecate fields, or change replacement behavior. CI should fail when the lock file changes without a clear reason in the pull request.

Now the repository is cleaner: no committed secrets, pinned modules, reviewed providers, and scanners checking common mistakes. The next layer comes from the cloud providers themselves.

## Provider Policy Checks
<!-- section-summary: Provider-native policy tools add rules based on the cloud platform's own access and governance systems. -->

**Provider policy checks** are rules enforced or evaluated by the cloud platform. IaC scanners read code before deployment. Provider policy systems understand the cloud provider's own resource model, organization rules, IAM language, and sometimes the live account context. Both layers help because they see different things.

In AWS, the Northstar team can validate IAM policy documents with IAM Access Analyzer before attaching them to roles. This catches policy language issues and security warnings that a generic Terraform scanner may not explain as well.

```bash
aws accessanalyzer validate-policy \
  --policy-document file://worker-receipts-policy.json \
  --policy-type IDENTITY_POLICY
```

The result can warn about missing resources, overly broad access, unsupported actions, or policy structure problems. That feedback belongs next to the Terraform scanner output because IAM bugs often create the largest blast radius.

Azure teams usually pair IaC review with **Azure Policy**. Azure Policy can define rules such as allowed regions, required tags, required private endpoints, or denied public network access. Teams often keep policy definitions and assignments in a repository too, so policy changes receive the same review as infrastructure changes.

Google Cloud teams use **Organization Policy** constraints to control behavior across projects and folders. For example, a platform team can restrict public IP usage, control allowed regions, or limit external sharing patterns. Terraform can describe resources, and organization policy can still deny a resource that violates the central rule.

These provider checks are especially useful for guardrails that must hold across many repositories. A scanner in one repo can be skipped by a broken CI job. A cloud organization policy or account-level deny still protects the environment when a request reaches the provider. That is why mature teams usually combine repository checks with cloud-side guardrails instead of choosing only one.

The final step is packaging all this feedback so engineers can actually act on it in a pull request.

## Pull Request Feedback That Engineers Can Use
<!-- section-summary: A useful PR gate is strict on high-risk changes and clear enough for the author to fix the problem quickly. -->

A **PR gate** is a CI check that must pass before a pull request can merge. For IaC security, the gate should be strict about high-risk findings and readable enough that engineers understand the next edit. If the gate produces hundreds of low-value warnings, people learn to ignore it. If the gate silently passes broad access, it gives false confidence.

The Northstar PR gate can run in layers. The first layer checks formatting and validation. The second layer produces the plan. The third layer scans source and plan output. The fourth layer checks secrets. The fifth layer runs focused provider-native checks for IAM policies or cloud governance rules. The pull request comment then summarizes only the findings that need action.

```bash
terraform fmt -check
terraform validate
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json

checkov -d .
checkov -f tfplan.json
gitleaks detect --source . --redact
```

A helpful PR comment for the risky version could look like this:

```markdown
### Infrastructure security gate failed

This pull request creates or changes 7 resources.

Blocking findings:

- `aws_security_group.database`: PostgreSQL is open to `0.0.0.0/0`. Limit ingress to the application security group or a private CIDR.
- `aws_s3_bucket_public_access_block.receipts`: Public access protections are disabled for the receipts bucket. Enable all four public access block settings.
- `aws_iam_role_policy.worker_receipts`: Worker role grants `s3:*` on `*`. Scope actions to `s3:GetObject`, `s3:PutObject`, and required bucket-level actions on the receipt bucket only.

Review warnings:

- `module.receipt_storage`: Module version changed from `4.0.1` to `4.1.2`. Confirm the changelog and replacement behavior.
- `terraform plan`: No deletes detected.
```

Notice how the gate separates blocking findings from review warnings. A public database path should block the merge. A module version update often needs human review, and the team can decide whether that warning blocks based on the environment and blast radius. This distinction matters because teams keep security checks healthy when the gate feels accurate.

Exceptions need the same care. Sometimes a public resource is intentional, such as a public static website bucket or an internet-facing load balancer. The exception should live near the resource, include a reason, name an owner, and expire when possible. A permanent, unexplained skip comment turns the scanner into decoration.

CI also needs permissions discipline. The workflow that runs `terraform plan` should use a read-limited or plan-limited role where possible. The workflow that runs `terraform apply` should require stronger approval, protected branches, and separate credentials. A pull request from an untrusted fork should never receive production cloud credentials just to calculate a plan.

Now we can put the full workflow together for the Northstar release.

## Putting It All Together
<!-- section-summary: The secure workflow checks code, plan, secrets, modules, provider rules, and merge feedback before apply. -->

The Northstar release adds a feature: customers need downloadable payment receipts. The first Terraform draft creates a bucket, network rule, and worker role. Without IaC security, the pull request could merge and the apply step could create public storage posture, internet-facing database access, and broad S3 permissions in the production account.

With IaC security, the same change moves through a review path before cloud APIs create anything important. The author opens a pull request. CI formats and validates the code. Terraform or OpenTofu creates a plan and JSON plan output. Checkov, tfsec, or Terrascan scans the configuration and plan. A secrets scanner checks for committed credentials. Module and provider version changes show up in the diff. AWS IAM Access Analyzer validates the worker policy. Cloud-side guardrails still stand behind the repository checks.

The safer Terraform version then replaces the risky draft. The bucket blocks public access and uses server-side encryption. The database security group accepts traffic from the application tier instead of the whole internet. The worker role receives only the S3 actions it needs on the receipt bucket. The pull request records the reason for the module version, and the CI comment gives reviewers a short list of what changed.

This is the practical value of IaC security. The team does not wait for a security incident, a cloud audit, or a production ticket to find the problem. The code review catches the risky design while the author can still change a few lines.

![IaC security summary showing plan review, IaC scans, secrets checks, module review, provider policy, pull request feedback, and controlled apply](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/iac-security-summary.png)

*The summary shows the full Northstar PR review path: plan, scan, secrets, modules, provider policy, and a safer apply at the end.*

## What's Next

This article focused on security checks around infrastructure code: plans, scanners, secrets, modules, provider validation, and pull request gates. The next article goes one layer deeper into **Policy as Code**.

Policy as Code means the organization writes security and compliance rules as versioned code too. Instead of relying only on scanner defaults, the platform team can express rules like "production databases must stay private," "storage with customer data must use approved encryption," or "IAM policies cannot grant wildcard admin access." That gives teams a shared rulebook they can test, review, and improve over time.

---

**References**

- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - Official Terraform documentation for creating an execution plan before applying infrastructure changes.
- [Terraform show command](https://developer.hashicorp.com/terraform/cli/commands/show) - Official Terraform documentation for inspecting saved plans and producing JSON output.
- [OpenTofu plan command](https://opentofu.org/docs/cli/commands/plan/) - Official OpenTofu documentation for previewing infrastructure changes.
- [OpenTofu show command](https://opentofu.org/docs/cli/commands/show/) - Official OpenTofu documentation for viewing state or plan files, including JSON output.
- [Checkov CLI command reference](https://www.checkov.io/2.Basics/CLI%20Command%20Reference.html) - Official Checkov CLI documentation for scanning IaC files and plan output.
- [tfsec documentation](https://aquasecurity.github.io/tfsec/) - Official tfsec documentation for Terraform security scanning.
- [Terrascan documentation](https://runterrascan.io/docs/) - Official Terrascan documentation for scanning infrastructure as code.
- [Gitleaks documentation](https://github.com/gitleaks/gitleaks) - Official Gitleaks project documentation for detecting hardcoded secrets in repositories.
- [AWS IAM Access Analyzer policy validation](https://docs.aws.amazon.com/IAM/latest/UserGuide/access-analyzer-policy-validation.html) - Official AWS documentation for validating IAM policies before or during review.
- [Azure Policy as Code](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-as-code) - Official Microsoft guidance for managing Azure Policy definitions and assignments through code workflows.
- [Google Cloud Organization Policy Service](https://cloud.google.com/resource-manager/docs/organization-policy/overview) - Official Google Cloud documentation for organization-wide resource constraints.
- [NIST Secure Software Development Framework SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST guidance for secure software development practices, including automated security checks and protecting development workflows.
