---
title: "Policy as Code"
description: "Turn repeated infrastructure review rules into versioned checks that read plans, block risky changes, and record exceptions."
overview: "Start with a repeated cloud review rule, then follow it into Terraform plan inputs, a small OPA/Rego policy, local and CI execution, Sentinel or managed enforcement, and exception records with owners and expiry dates."
tags: ["devsecops", "policy-as-code", "opa", "terraform"]
order: 2
id: article-devsecops-cloud-infrastructure-security-policy-as-code
---

## Table of Contents

1. [The Review Rule Humans Get Tired Of Checking](#the-review-rule-humans-get-tired-of-checking)
2. [What Policy as Code Adds](#what-policy-as-code-adds)
3. [The Data That Policies Read](#the-data-that-policies-read)
4. [Writing a Small OPA Rule](#writing-a-small-opa-rule)
5. [Running Policies Locally and in CI](#running-policies-locally-and-in-ci)
6. [Sentinel and Managed Policy Enforcement](#sentinel-and-managed-policy-enforcement)
7. [Exceptions With Owners and Expiry](#exceptions-with-owners-and-expiry)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)
10. [References](#references)

## The Review Rule Humans Get Tired Of Checking
<!-- section-summary: Policy as Code starts with repeated review rules that humans should not have to re-check by hand every time. -->

Every infrastructure team has a few review comments that appear again and again. "Customer receipt buckets cannot be public." "Production databases cannot expose port `5432` to the internet." "Every production resource needs an owner tag." "Public access needs a ticket, an owner, and an expiry date."

A senior reviewer can write those comments by hand, and that works for a while. Then the pull requests get bigger. More teams start shipping. A reviewer is on call, the plan is noisy, and one risky rule slips through. The problem is not that the rule is hard to understand. The problem is that repeated checks are tiring, and tired humans miss boring but important details.

Policy as Code starts with that kind of repeated rule. Here is one Northstar rule in plain English:

> A bucket that stores customer receipts must block public ACLs and public bucket policies unless a reviewed exception names the resource, owner, reason, approver, and expiry date.

That rule is specific enough to automate. It names the resource type, the expected settings, and the exception evidence. The rest of this article turns that sentence into a working review gate.

## What Policy as Code Adds
<!-- section-summary: Policy as Code turns repeated review rules into versioned, testable decisions that run before apply. -->

**Policy as Code**, usually shortened to **PaC**, means an organization writes security, compliance, and governance rules as code. The rules live in version control. Engineers review changes to the rules. Tests prove the rules behave as expected. CI or a managed platform runs the rules against infrastructure inputs and returns pass, warn, or deny decisions.

The previous IaC security article used scanners to catch common mistakes in Terraform and OpenTofu. Scanners give teams a strong starting layer. Policy as Code adds the local rulebook: the rules that match your company, environment, data classes, exception process, approved regions, naming patterns, and risk appetite.

The Northstar customer portal gives us a concrete path. The team stores customer receipt PDFs, runs an API in private subnets, and deploys through Terraform. The platform team wants a small production rulebook:

| Rule | Plain-English check |
|---|---|
| Customer storage blocks public access | Receipt buckets use all public access block settings |
| Production regions are approved | Resources land in `us-east-1` or `us-west-2` |
| Resources have owners | Tags include `owner`, `service`, and `data-classification` |
| Databases stay private | Database ports avoid internet-wide ingress |
| Exceptions expire | Bypasses include an owner, approver, reason, and expiry |

Those rules should run every time. A human reviewer still checks architecture and intent. The policy engine checks the repeated rules and leaves evidence on the pull request.

![Policy inputs map showing plan JSON, run metadata, exception data, and approved lists flowing into a policy engine that returns pass, warn, or block](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/policy-inputs-map.png)

*The map shows how plan data, run context, exceptions, and approved lists flow into one policy decision that can pass, warn, or block.*

Before we write the rule, we need to see what data the rule can read.

## The Data That Policies Read
<!-- section-summary: A policy engine reads structured input such as plan JSON, run metadata, approved lists, and exception records. -->

A **policy engine** is a program that reads structured input and returns a decision. In an infrastructure workflow, the input is often Terraform plan JSON, OpenTofu plan JSON, Kubernetes YAML, cloud resource metadata, run metadata, or an exceptions file.

Terraform can create a saved plan and convert it into JSON:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
```

`terraform plan -out=tfplan` saves the proposed infrastructure change. `terraform show -json tfplan` writes a machine-readable version of that plan to `tfplan.json`. OPA, Conftest, Sentinel-style tooling, and custom scripts can inspect that JSON.

A tiny part of the plan for the Northstar receipt bucket looks like this:

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

`address` gives the Terraform resource address that should appear in the finding. `type` tells the policy which cloud resource shape it is looking at. `actions` says the plan will create this resource. `after` contains the values the resource will have after apply.

The policy can now ask a direct question: does every `aws_s3_bucket_public_access_block` resource set all four protection flags to `true`?

Real policies often need business context too. Northstar stores approved exceptions in a reviewed file:

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

The exception file gives the policy a way to allow a specific case while still checking owner, approver, reason, and expiry. A hidden skip comment inside a resource file can quietly disable a rule. A structured exception record gives reviewers something concrete to approve and later remove.

Now the input is clear, so the first rule can stay small.

## Writing a Small OPA Rule
<!-- section-summary: OPA and Rego express infrastructure rules as code and return resource-specific deny messages. -->

**Open Policy Agent**, usually called **OPA**, is a general-purpose policy engine. **Rego** is OPA's policy language. Rego reads input such as JSON and produces decisions such as allow, deny, warn, or data values chosen by the policy author.

Northstar starts with one rule: every planned S3 public access block resource must enable all four protection settings. The first version checks one setting so the shape is easy to see:

```rego
package terraform.security

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket_public_access_block"
  after := resource.change.after

  after.block_public_acls != true

  msg := sprintf("%s must enable block_public_acls", [resource.address])
}
```

`package terraform.security` names the policy package. `deny[msg]` creates a set of deny messages. `input.resource_changes[_]` loops through planned resources. The `resource.type` line selects S3 public access block resources. The `after` line reads the planned values. The final `msg` includes the Terraform address so the pull request author knows where to edit.

The full beginner rule repeats that same shape for each required flag:

```rego
package terraform.security

required_public_access_flags := [
  "block_public_acls",
  "block_public_policy",
  "ignore_public_acls",
  "restrict_public_buckets",
]

deny[msg] {
  resource := input.resource_changes[_]
  resource.type == "aws_s3_bucket_public_access_block"
  flag := required_public_access_flags[_]

  resource.change.after[flag] != true

  msg := sprintf("%s must enable %s", [resource.address, flag])
}
```

`required_public_access_flags` is a list of fields the policy expects. `flag := required_public_access_flags[_]` checks each field. `resource.change.after[flag]` reads the planned value by field name. One compact rule now checks all four flags and returns one deny message for each missing protection.

The Terraform fix is straightforward:

```hcl
resource "aws_s3_bucket_public_access_block" "receipts" {
  bucket = aws_s3_bucket.receipts.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}
```

The policy does not need to understand every reason a bucket exists. It checks a repeated production rule and gives the author a clear message. A richer policy can later connect the bucket's tags, data classification, and exception records.

![OPA rule flow showing Terraform plan data entering Rego checks, deny messages, CI feedback, and a block or pass decision](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/opa-rule-flow.png)

*The flow shows the practical job of a Rego rule: select the resource change, match a rule, produce a deny message, and turn that into useful PR feedback.*

The rule exists now. The next step is running it close to the engineer and in the shared delivery path.

## Running Policies Locally and in CI
<!-- section-summary: Good policy workflows give authors fast local feedback and strict pull request gates for risky changes. -->

Local policy checks help authors fix problems before they push. **Conftest** is a common CLI that runs OPA policies against configuration files and JSON inputs. Northstar stores the Rego file at `policy/terraform/security.rego`, generates a plan JSON, and tests the plan:

```bash
terraform plan -out=tfplan
terraform show -json tfplan > tfplan.json
conftest test tfplan.json --policy policy/terraform
```

The first two commands create the policy input. `conftest test` evaluates `tfplan.json`. `--policy policy/terraform` points Conftest at the folder that contains the Rego files.

A failing result might look like this:

```bash
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable block_public_acls
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable block_public_policy
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable ignore_public_acls
FAIL - tfplan.json - terraform.security - aws_s3_bucket_public_access_block.receipts must enable restrict_public_buckets
```

Each line names the input file, policy package, resource address, and failed setting. That is enough for the author to edit the Terraform resource without opening the full plan JSON.

The same check belongs in CI after formatting, validation, plan generation, scanner checks, and secret checks. A pull request summary can stay short:

```markdown
### Policy as Code gate failed

Blocking rules:

- `storage.public_access_block`: `aws_s3_bucket_public_access_block.receipts` disables public access protections for a customer data bucket.
- `tags.required`: `aws_db_instance.portal` is missing `data-classification`.
- `regions.allowed`: `aws_s3_bucket.archive` plans a resource outside approved production regions.

Exception path:

Open a security exception record with `id`, `rule`, `resource`, `reason`, `owner`, `approved_by`, and `expires`.
Exceptions over 30 days require security owner review.
```

The summary names the rule, resource, risk, and exception path. It keeps the author in the pull request instead of sending them to raw JSON. The CI job should also run with careful credentials. A policy check that reads a generated plan usually needs no production write access. The apply job can use a separate deployment role with protected environment approval.

Some teams run all policies in their own CI. Others add managed policy enforcement around Terraform workspaces.

## Sentinel and Managed Policy Enforcement
<!-- section-summary: Managed Terraform platforms can evaluate policies at plan time and record the result with the workspace run. -->

**HashiCorp Sentinel** is a Policy as Code language used with HCP Terraform and Terraform Enterprise. In that workflow, the managed platform creates the plan, exposes structured imports such as `tfplan/v2`, runs Sentinel policies, and records the result with the workspace run before apply.

Northstar might use OPA and Conftest in GitHub Actions for fast pull request feedback, then use Sentinel in HCP Terraform as the final workspace gate. The same idea carries through both systems: a policy reads structured plan data and decides whether the run can continue.

Here is a small Sentinel policy that checks required tags on newly created managed resources:

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

`import "tfplan/v2" as tfplan` gives the policy access to the plan. `required_tags` names the fields Northstar expects. The `violations` filter selects newly created managed resources that miss at least one required tag. `main` is the final pass or fail rule.

Managed platforms often support advisory and mandatory enforcement. An advisory policy warns reviewers. A mandatory policy blocks the run. Northstar can start new rules as advisory while the platform team checks noise, fixes existing resources, and improves messages. Rules with clear fixes and high confidence can move to mandatory enforcement, such as public database ingress, missing encryption on customer data storage, production resources outside approved regions, or high-risk IAM wildcards.

Provider governance still has a place behind these gates. AWS Organizations service control policies, Azure Policy, and Google Cloud Organization Policy can deny dangerous provider requests even when a repository check fails to run. Policy as Code works best as a stack: local checks for speed, CI checks for pull request evidence, managed workspace checks for apply-time control, and provider guardrails for broad organization boundaries.

Policy engines need one more production detail: real exceptions.

## Exceptions With Owners and Expiry
<!-- section-summary: Exceptions keep policy practical by allowing reviewed risk for a specific resource, owner, reason, and time window. -->

An **exception** is a documented approval to bypass or modify a policy for a specific case. Exceptions exist because production systems have unusual needs. A public load balancer is normal. A public static website bucket can be valid. A short network opening during a vendor migration may be approved for a narrow window.

The risk comes from broad, permanent, unexplained exceptions. A comment that says `skip policy` gives the team no owner, no expiry, and no review trail. Northstar uses structured exception records instead:

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

Each field has a job. `id` links the exception to a ticket or review record. `rule` names the policy. `resource` limits the exception to one Terraform address. `reason` explains the business need. `owner` names the team responsible for cleanup. `approved_by` records who accepted the risk. `expires` creates a follow-up date.

The policy should validate exceptions too. It can reject expired exceptions, broad resource patterns, missing owners, missing approvers, or expiry windows longer than the standard limit. For customer data, the exception review should also ask for compensating controls such as no uploads, no sensitive objects, access logging, an IP allowlist, monitoring, or a rollback command.

A pull request should show accepted exceptions beside the policy result:

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

That record helps engineers understand why the gate allowed the change. It also gives security reviewers a search target for expiring exceptions. The goal is an explicit risk decision, not a hidden bypass.

## Putting It All Together
<!-- section-summary: Policy as Code gives teams a reviewed rulebook that runs locally, in pull requests, and in managed apply gates. -->

The Northstar team now has a practical rulebook. Customer data storage blocks public access. Production resources use approved regions. Resources have owner and service tags. Databases stay private. IAM policies avoid broad wildcards. Exceptions include a rule, exact resource, owner, approver, reason, and expiry.

The rules live in a policy repository or a shared platform folder. Engineers can run them locally with Conftest and OPA against `tfplan.json`. Pull requests run the same checks after formatting, validation, plan generation, IaC scanning, and secret scanning. HCP Terraform or Terraform Enterprise can run Sentinel policies at the workspace level before apply. Provider guardrails still exist across the account, subscription, folder, or organization.

The most important production detail is rule quality. A rule that blocks real public database exposure earns trust. A rule with vague messages and constant false alarms gets bypassed. Good platform teams test policies with sample plans, publish passing and failing examples, write readable deny messages, and promote rules to mandatory only after the fix path is clear.

The result is a security review that scales. A senior reviewer can focus on design: should this service exist, should this data path be public, should this team own the resource, and should this exception be accepted? The policy engine handles the repeated checks that every production change must satisfy.

![Policy as Code summary showing rule authoring, local tests, CI enforcement, managed policy checks, exception expiry, and review evidence](/content-assets/articles/article-devsecops-cloud-infrastructure-security-policy-as-code/policy-as-code-summary.png)

*The summary shows the operating loop: write rules, test locally, run them in CI, handle exceptions, and keep evidence for later review.*

## What's Next
<!-- section-summary: The next article moves from planned infrastructure changes to the live cloud environment after deployment. -->

Policy as Code checks the plan before apply. That gives Northstar a strong gate at the planned change. The live cloud account can still change afterward through console edits, emergency fixes, old scripts, provider tools, or unauthorized access.

The next article follows that problem. It looks at **drift and perimeter security**, where the team compares reviewed code with the real cloud account, detects public exposure, investigates audit logs, and brings the environment back under code.

## References

- [Open Policy Agent policy language](https://www.openpolicyagent.org/docs/latest/policy-language/) - Official OPA documentation for writing Rego policies.
- [Open Policy Agent Terraform tutorial](https://www.openpolicyagent.org/docs/latest/terraform/) - Official OPA guide for evaluating Terraform plans.
- [Conftest documentation](https://www.conftest.dev/) - Official Conftest documentation for testing configuration data with OPA policies.
- [Terraform JSON output format](https://developer.hashicorp.com/terraform/internals/json-format) - Official Terraform documentation for the machine-readable plan and state JSON format.
- [HCP Terraform policy enforcement](https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement) - Official HashiCorp documentation for policy checks in HCP Terraform and Terraform Enterprise.
- [Sentinel documentation](https://developer.hashicorp.com/sentinel/docs) - Official HashiCorp documentation for the Sentinel policy language and runtime.
- [AWS Organizations service control policies](https://docs.aws.amazon.com/organizations/latest/userguide/orgs_manage_policies_scps.html) - Official AWS documentation for organization-level permission guardrails.
- [Azure Policy as Code](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/policy-as-code) - Official Microsoft guidance for managing Azure Policy definitions and assignments as code.
- [Google Cloud Organization Policy Service](https://cloud.google.com/resource-manager/docs/organization-policy/overview) - Official Google Cloud documentation for organization-wide policy constraints.
- [NIST Secure Software Development Framework SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST guidance for secure development practices, automated checks, and evidence in delivery workflows.
