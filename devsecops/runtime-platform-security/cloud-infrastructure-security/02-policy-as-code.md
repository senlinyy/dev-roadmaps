---
title: "Policy as Code"
description: "Turn repeated infrastructure and deployment review rules into automated checks that can block risky changes."
overview: "Policy as Code turns repeated cloud review rules into versioned, testable checks that can read plans, enforce exceptions, and leave useful evidence in pull requests."
tags: ["devsecops", "policy-as-code", "opa", "terraform"]
order: 2
id: article-devsecops-cloud-infrastructure-security-policy-as-code
---

## Table of Contents

1. [What Policy as Code Adds](#what-policy-as-code-adds)
2. [The Customer Portal Rulebook](#the-customer-portal-rulebook)
3. [The Data That Policies Read](#the-data-that-policies-read)
4. [Writing a Small OPA Rule](#writing-a-small-opa-rule)
5. [Running Policies Locally and in CI](#running-policies-locally-and-in-ci)
6. [Sentinel and Managed Policy Enforcement](#sentinel-and-managed-policy-enforcement)
7. [Exceptions With Owners and Expiry](#exceptions-with-owners-and-expiry)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Policy as Code Adds
<!-- section-summary: Policy as Code turns repeated review rules into versioned checks that can run before infrastructure is applied. -->

The previous article used IaC scanners to catch common mistakes in Terraform, OpenTofu, modules, secrets, and plan output. That gives a team a strong first layer. The next layer is **Policy as Code**, usually shortened to **PaC**. Policy as Code means the organization writes its own security and compliance rules as code, stores those rules in version control, tests them, reviews them, and runs them automatically in pull requests or managed deployment platforms.

Think about the kind of comments a senior engineer leaves again and again: production databases must stay private, customer data storage needs encryption, every resource needs an owner tag, production changes need an approved region, and public access needs a named exception. Those comments are valuable, but humans miss things when a pull request is large or when the incident queue is loud. Policy as Code takes the repeated parts of that review and makes them executable.

The important idea is **repeatable judgment**. A scanner might include a default rule that says public object storage is risky. Your organization can add the local rule that says a public bucket is allowed only for the static marketing site, only in the `web-prod` workspace, only when the resource has an approved exception ticket, and only when that exception expires within 30 days. That local rule is where Policy as Code starts to matter in real production work.

Policy as Code also creates evidence. A pull request can show which rules ran, which inputs they inspected, which resources failed, who approved an exception, and when the exception expires. That evidence helps engineers fix the change today, and it helps security teams answer audit questions later.

## The Customer Portal Rulebook
<!-- section-summary: A concrete portal scenario shows why teams need their own guardrails beyond scanner defaults. -->

Let's keep following the Northstar customer portal from the IaC security article. The team stores customer receipts, runs an API in private subnets, and deploys through Terraform. The first article caught obvious mistakes: public storage settings, a database security group open to the internet, and a worker role with `s3:*` on `*`.

Now the platform team wants a small rulebook that every infrastructure pull request must follow. The rules are plain enough to say out loud. Production resources must live in `us-east-1` or `us-west-2`. Every resource must carry `owner`, `service`, and `data-classification` tags. Any bucket that stores customer data must use encryption. Public access to storage must have an approved exception with an owner and expiry date. Databases must avoid public IPs and public ingress.

Those rules cross several tools. Terraform writes the resources. The plan shows the actual proposed values. OPA or Sentinel evaluates the plan. CI reports the result on the pull request. A human still reviews the design, but the rulebook handles the repeatable checks every time.

Here is the kind of Terraform change the team wants to control:

```hcl
resource "aws_s3_bucket" "receipts" {
  bucket = "northstar-payment-receipts-prod"

  tags = {
    owner               = "payments-platform"
    service             = "customer-portal"
    data-classification = "customer"
  }
}

resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = false
  block_public_policy     = false
  ignore_public_acls      = false
  restrict_public_buckets = false
}
```

The tags are good. The public access block settings are risky because this bucket stores customer receipts. A default scanner can flag the public settings. The local policy can add the business rule: customer data buckets need public access blocked unless a time-limited exception exists.

That local rule needs input data, so the next section looks at what a policy engine actually reads.

## The Data That Policies Read
<!-- section-summary: Policies need structured input, usually plan JSON plus optional business context such as exceptions and ownership. -->

A **policy engine** is a program that reads structured input and decides whether the input follows a set of rules. The engine can return allow, deny, warnings, or detailed messages. In infrastructure workflows, the input is often Terraform plan JSON, OpenTofu plan JSON, Kubernetes YAML, cloud resource metadata, or a small JSON file that lists approved exceptions.

Terraform and OpenTofu can produce a saved plan and convert that plan into JSON:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
```

The JSON is large, but the part a policy cares about is understandable. A planned resource has a type, an address, an action, and the values after the change:

```json
{
  "resource_changes": [
    {
      "address": "aws_s3_bucket_public_access_block.receipts",
      "type": "aws_s3_bucket_public_access_block",
      "change": {
        "actions": ["create"],
        "after": {
          "block_public_acls": false,
          "block_public_policy": false,
          "ignore_public_acls": false,
          "restrict_public_buckets": false
        }
      }
    }
  ]
}
```

The policy can read that object and ask a direct question: does a planned S3 public access block resource set all four protection flags to `true`? If the answer is no, the policy can deny the change and print a message with the exact resource address.

Real policies often need more than the plan. The Northstar team also needs exception data because a public resource might be intentional for a narrow use case. That exception data can live in a reviewed file:

```yaml
exceptions:
  - id: SEC-1842
    resource: aws_s3_bucket_public_access_block.marketing_site
    reason: Public static website bucket approved by security review.
    owner: web-platform
    expires: 2026-07-15
```

This separate file matters because exceptions should receive review too. A hidden skip comment in a resource file can quietly disable a rule. A structured exception record gives the reviewer a reason, an owner, and a date when the exception should be removed or renewed.

![Policy inputs map showing plan JSON, run metadata, exception data, and approved lists flowing into a policy engine that returns pass, warn, or block](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/policy-inputs-map.png)

*The map shows how plan data, run context, exceptions, and approved lists flow into one policy decision that can pass, warn, or block.*

Now that the input is clear, the team can write a rule.

## Writing a Small OPA Rule
<!-- section-summary: OPA and Rego let teams express infrastructure review rules with resource-specific deny messages. -->

**Open Policy Agent**, usually called **OPA**, is a general-purpose policy engine. It uses a policy language called **Rego**. Rego reads structured input such as JSON, then produces decisions. In a Terraform workflow, OPA can read `tfplan.json` and return deny messages for resources that violate the rulebook.

The Northstar team writes a small first rule: every S3 public access block resource must enable all four protections. The rule is small, but it has the shape of a real production rule. It loops through planned resources, selects S3 public access block resources, checks the final values, and returns a useful message.

```rego
package terraform.security

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket_public_access_block"
  after := resource.change.after

  not after.block_public_acls

  msg := sprintf("%s must enable block_public_acls", [resource.address])
}

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket_public_access_block"
  after := resource.change.after

  not after.block_public_policy

  msg := sprintf("%s must enable block_public_policy", [resource.address])
}

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket_public_access_block"
  after := resource.change.after

  not after.ignore_public_acls

  msg := sprintf("%s must enable ignore_public_acls", [resource.address])
}

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket_public_access_block"
  after := resource.change.after

  not after.restrict_public_buckets

  msg := sprintf("%s must enable restrict_public_buckets", [resource.address])
}
```

The word `deny` is just a rule name chosen by the policy author. The CI job can treat any value in `deny` as a blocking finding. The message includes the Terraform resource address, so the author knows exactly where to edit.

The safer Terraform change sets all four flags to `true`:

```hcl
resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

This rule handles one storage control. A real policy pack can add region checks, tag checks, encryption checks, network checks, IAM wildcard checks, and exception checks. The team should keep rules small and named around one idea, because a clear rule is easier to test and easier to explain in a pull request.

![OPA rule flow showing Terraform plan data entering Rego checks, deny messages, CI feedback, and a block or pass decision](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/opa-rule-flow.png)

*The flow shows the practical job of a Rego rule: select the resource change, match a rule, produce a deny message, and turn that into useful PR feedback.*

Now the rule needs to run where engineers can see it.

## Running Policies Locally and in CI
<!-- section-summary: Good policy workflows give authors fast local feedback and strict pull request gates for high-risk failures. -->

Policy as Code works best when engineers can test rules before pushing. **Conftest** is a common CLI wrapper around OPA for testing configuration files and JSON inputs. The team can save the Rego policy under `policy/terraform/security.rego`, generate a plan JSON, and evaluate it locally:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
conftest test tfplan.json --policy policy/terraform
```

A failing local result might look like this:

```bash
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable block_public_acls
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable block_public_policy
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable ignore_public_acls
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable restrict_public_buckets
```

The same command belongs in CI. The pull request gate should run formatting, validation, plan generation, scanner checks, secret checks, and policy checks. The policy part can produce a short markdown summary:

```markdown
### Policy as Code gate failed

Blocking rules:

- `storage.public_access_block`: `aws_s3_bucket_public_access_block.receipts` disables public access protections for a customer data bucket.
- `tags.required`: `aws_db_instance.portal` is missing `data-classification`.
- `regions.allowed`: `aws_s3_bucket.archive` plans a resource outside approved production regions.

Exception path:

Open a security exception record with `id`, `resource`, `reason`, `owner`, and `expires`.
Exceptions over 30 days require security owner review.
```

Notice the tone of this output. It names the rule, the resource, the reason, and the next path. The gate should avoid sending engineers into raw JSON unless the raw JSON is useful. A readable gate builds trust because the author can fix the problem without guessing what the policy meant.

The CI job also needs safe credentials. A pull request policy check can run from plan JSON, so it often needs no production write access. The apply job should use a separate deployment role, protected branch rules, and environment approvals. Policy as Code should support that separation instead of requiring a broad credential just to evaluate a file.

Some teams run these checks in their own CI. Other teams use a managed Terraform platform with policy enforcement built in.

## Sentinel and Managed Policy Enforcement
<!-- section-summary: Managed Terraform platforms can enforce policy checks at plan time and record the result with the workspace run. -->

HashiCorp Sentinel is another Policy as Code language used with HCP Terraform and Terraform Enterprise. In that workflow, the platform creates a plan, passes structured imports such as `tfplan/v2` into the policy, and enforces the result before apply. This is common in organizations that already run Terraform through managed workspaces.

The Northstar team might use OPA in GitHub Actions for fast pull request checks and Sentinel in HCP Terraform for the final workspace gate. The key idea stays the same: a policy reads structured plan data and decides whether the run can continue.

A Sentinel policy can express a required tag rule:

```hcl
import "tfplan/v2" as tfplan

required_tags = ["owner", "service", "data-classification"]

violations = filter tfplan.resource_changes as _, rc {
  rc.mode is "managed" and
  rc.change.actions contains "create" and
  any required_tags as tag {
    rc.change.after.tags[tag] is null
  }
}

main = rule {
  length(violations) is 0
}
```

In a managed platform, policy results can be advisory or mandatory. An advisory policy warns reviewers. A mandatory policy blocks the run. The team should reserve mandatory enforcement for rules with strong confidence and clear fixes: public database ingress, missing encryption for customer data, production changes outside approved regions, missing owner tags, or high-risk IAM wildcards.

This split keeps the gate useful. New rules can start as advisory while the team measures noise and fixes legitimate existing drift. Once the rule is accurate, the platform team can promote it to mandatory. That progression gives engineers time to adjust without weakening the final production guardrail.

Policy engines are powerful, but they need a careful exception process.

## Exceptions With Owners and Expiry
<!-- section-summary: Exceptions keep the gate practical by allowing reviewed risk with a named owner, reason, and expiry date. -->

An **exception** is a documented approval to bypass or modify a policy for a specific case. Exceptions are part of real security work because production systems have unusual needs. A public load balancer is normal. A public static website bucket can be valid. A temporary open network path might be approved during a vendor migration. The risk comes from exceptions that have no owner, no reason, and no end date.

The Northstar team uses structured exception records. The policy can read them alongside the plan:

```yaml
exceptions:
  - id: SEC-2128
    rule: storage.public_access_block
    resource: aws_s3_bucket_public_access_block.marketing_site
    reason: Public website bucket for static marketing assets.
    owner: web-platform
    approved_by: security-platform
    expires: 2026-07-15
```

The policy should check the exception too. It should verify that the exception references the exact resource, names the rule, has an owner, has an approval source, and has an expiry inside the allowed window. A broad exception such as "skip all storage rules" gives the team no useful control.

For customer data, the exception process should ask for compensating controls. A public static website exception might require no customer data, no upload path, object ownership controls, access logging, and a content review path. A temporary database network exception might require a short expiry, a named incident ticket, an IP allowlist, a rollback command, and monitoring during the window.

The pull request should show the exception evidence next to the policy result:

```markdown
### Policy exception accepted

- Rule: `storage.public_access_block`
- Resource: `aws_s3_bucket_public_access_block.marketing_site`
- Exception: `SEC-2128`
- Owner: `web-platform`
- Approved by: `security-platform`
- Expires: `2026-07-15`
- Follow-up: remove public access after the static site migration completes
```

That record helps two groups. Engineers see why the gate allowed the change. Security reviewers can later search for expiring exceptions and close them. Auditors can see that the organization made an explicit decision instead of quietly disabling a check.

Now the Northstar workflow has scanner checks, custom policies, managed enforcement, and exceptions. The final step is putting it together as one operating loop.

## Putting It All Together
<!-- section-summary: Policy as Code gives teams a reviewed rulebook that runs in local checks, pull requests, and managed apply gates. -->

The Northstar team uses a clear rulebook. Production resources need approved regions. Customer data storage needs encryption and public access blocking. Resources need owner and service tags. IAM policies need narrow actions and resources. Exceptions need an owner, approval, reason, and expiry.

The rules live in a policy repository or a shared platform folder. Engineers can run them locally with Conftest and OPA against `tfplan.json`. Pull requests run the same checks after formatting, validation, plan generation, IaC scanning, and secret scanning. HCP Terraform or Terraform Enterprise can run Sentinel policies at the workspace level before apply. Cloud-side governance still exists behind all of this through services such as AWS Organizations policies, Azure Policy, or Google Cloud Organization Policy.

The biggest practical detail is rule quality. A rule that blocks a real public database risk earns trust. A rule that fails on harmless resources every day gets bypassed. Good platform teams test policies with sample plans, publish examples, add readable messages, and move rules from advisory to mandatory only when the fixes are clear.

The result is a security review that scales. A senior reviewer can focus on design: should this service exist, should this data flow be public, should this team own the resource, and should the exception be accepted. The policy engine handles the repeated checks that every production change must satisfy.

![Policy as Code summary showing rule authoring, local tests, CI enforcement, managed policy checks, exception expiry, and review evidence](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/policy-as-code-summary.png)

*The summary shows the operating loop: write rules, test locally, run them in CI, handle exceptions, and keep evidence for later review.*

## What's Next
<!-- section-summary: The next article moves from planned infrastructure changes to the live cloud environment after deployment. -->

Policy as Code checks the plan before apply. That gives the team a strong gate at the moment of change. The live cloud environment still changes after deployment through console edits, emergency fixes, provider defaults, old scripts, and sometimes unauthorized access.

The next article follows that problem. It looks at **drift and perimeter security**, where the team compares reviewed code with the real cloud account, detects public exposure, investigates audit logs, and brings the environment back under code.

---

**References**

- [Open Policy Agent policy language](https://www.openpolicyagent.org/docs/latest/policy-language/) - Official OPA documentation for writing Rego policies.
- [Conftest documentation](https://www.conftest.dev/) - Official Conftest documentation for testing configuration data with OPA policies.
- [Terraform JSON output format](https://developer.hashicorp.com/terraform/internals/json-format) - Official Terraform documentation for the machine-readable plan and state JSON format.
- [HCP Terraform policy enforcement](https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement) - Official HashiCorp documentation for policy checks in HCP Terraform and Terraform Enterprise.
- [Sentinel documentation](https://developer.hashicorp.com/sentinel/docs) - Official HashiCorp documentation for the Sentinel policy language and runtime.
- [Azure Policy as Code](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-as-code) - Official Microsoft guidance for managing Azure Policy definitions and assignments as code.
- [Google Cloud Organization Policy Service](https://cloud.google.com/resource-manager/docs/organization-policy/overview) - Official Google Cloud documentation for organization-wide policy constraints.
- [NIST Secure Software Development Framework SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST guidance for secure development practices, including automated checks and evidence in delivery workflows.
