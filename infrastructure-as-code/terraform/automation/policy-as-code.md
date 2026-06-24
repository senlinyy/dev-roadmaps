---
title: "Policy as Code"
description: "Enforce organization-wide infrastructure standards automatically using OPA and Sentinel so non-compliant configurations are blocked before they reach production."
overview: "Policy as code checks Terraform plans against rules your organization cares about. This article shows plan JSON, OPA/Rego and Sentinel-style checks, where resource values appear in the plan, and how teams choose rules that protect production without blocking every small change."
tags: ["policy as code", "opa", "sentinel", "compliance", "terraform"]
order: 3
id: article-iac-terraform-automation-policy
---

## Table of Contents

1. [What Policy as Code Means](#what-policy-as-code-means)
2. [Why Plan JSON Is the Useful Input](#why-plan-json-is-the-useful-input)
3. [An OPA Rule for Required Tags](#an-opa-rule-for-required-tags)
4. [A Sentinel-Style Guardrail for Dangerous Actions](#a-sentinel-style-guardrail-for-dangerous-actions)
5. [Where Policy Runs in CI/CD](#where-policy-runs-in-cicd)
6. [Writing Rules Teams Can Live With](#writing-rules-teams-can-live-with)
7. [Putting It All Together](#putting-it-all-together)

## What Policy as Code Means
<!-- section-summary: Policy as code turns infrastructure rules into versioned checks that run before Terraform applies changes. -->

**Policy as code** means writing infrastructure rules in code and running them automatically. Instead of asking every reviewer to remember every standard, the pipeline checks the plan for known risks.

Common Terraform policies include required tags, blocked public access, approved regions, encryption requirements, maximum instance sizes, protected database deletion, and restricted IAM wildcards. These rules protect production from mistakes that can be hard to spot in a long plan.

Two common policy paths are Open Policy Agent, usually with Rego policies, and HashiCorp Sentinel in HCP Terraform or Terraform Enterprise. The exact tool can vary, but the workflow is similar: generate a plan, convert it to machine-readable data, run rules, and block non-compliant changes.

## Why Plan JSON Is the Useful Input
<!-- section-summary: Plan JSON contains the evaluated resource changes, so policies can inspect what Terraform intends to create, update, replace, or destroy. -->

Policies can scan raw `.tf` files, but plan JSON is often more useful because it shows evaluated values. Variables and locals have already been resolved, `for_each` instances have addresses, and Terraform knows the action for each resource.

The pipeline creates a plan and exports JSON:

```bash
terraform plan -var-file=terraform.tfvars -out=tfplan
terraform show -json tfplan > tfplan.json
```

If the Terraform resource consumes tags from locals:

```hcl
resource "aws_s3_bucket" "logs" {
  bucket = local.bucket_name
  tags   = local.common_tags
}
```

The human plan shows the evaluated tags:

```hcl
  # aws_s3_bucket.logs will be created
  + resource "aws_s3_bucket" "logs" {
      + bucket = "dp-billing-prod-logs"
      + tags   = {
          + "environment" = "prod"
          + "managed_by"  = "terraform"
          + "service"     = "billing"
        }
    }
```

The JSON plan contains the same kind of evaluated result in a structure policy engines can inspect. That is why policy checks usually run after plan.

## An OPA Rule for Required Tags
<!-- section-summary: OPA policies can inspect plan resource changes and deny resources that miss required evaluated tags. -->

Here is a small Rego policy that denies managed resources missing required tags:

```rego
package terraform.tags

required_tags := {"service", "environment", "managed_by"}

deny[msg] {
  change := input.resource_changes[_]
  change.mode == "managed"
  action := change.change.actions[_]
  action == "create"

  tags := object.get(change.change.after, "tags", {})
  missing := required_tags - {tag | tags[tag]}
  count(missing) > 0

  msg := sprintf("%s is missing required tags: %v", [change.address, missing])
}
```

If the bucket lacks `managed_by`, the policy can fail with a message like:

```hcl
aws_s3_bucket.logs is missing required tags: {"managed_by"}
```

This is much better than discovering missing tags during cost allocation cleanup two months later. The policy fails while the pull request is still small and the author still has the context.

:::expand[Policy should inspect the value Terraform will apply]{kind="pattern"}
Raw configuration checks can miss evaluated values. A resource might say `tags = local.common_tags`, and the raw file does not show which tags the resource will receive. Plan JSON shows the evaluated tag map after Terraform resolves variables and locals.

This matters for modules. A shared module may apply tags correctly even though the root module never writes a literal `tags` map. A plan-based policy can judge the final resource change instead of guessing from source text.

Raw static scans still help for some checks, such as banned provider blocks or hardcoded secrets. For resource compliance, plan JSON usually gives the clearest input.
:::

## A Sentinel-Style Guardrail for Dangerous Actions
<!-- section-summary: Sentinel-style policies can block risky plan actions, such as deleting protected databases, before apply. -->

Some policies focus on actions rather than attributes. A production database destroy should require a special process. A policy can inspect resource changes and reject deletes for protected resource types.

A Sentinel-style rule can express that idea:

```hcl
import "tfplan/v2" as tfplan

protected_types = [
  "aws_db_instance",
  "aws_rds_cluster",
]

main = rule {
  all tfplan.resource_changes as _, change {
    change.type not in protected_types or
    "delete" not in change.change.actions
  }
}
```

The plan action is the key. If Terraform shows a delete for a protected database, the policy blocks the run before provider delete calls happen. Teams can still create an exception process, but the exception should be explicit and reviewed.

## Where Policy Runs in CI/CD
<!-- section-summary: Policy checks usually run after plan and before apply, with different severity levels for development and production. -->

A practical pipeline order is:

```bash
terraform fmt -check -recursive
terraform init -backend-config=backend.hcl
terraform validate
terraform plan -var-file=terraform.tfvars -out=tfplan
terraform show -json tfplan > tfplan.json
opa eval --data policy --input tfplan.json "data.terraform.tags.deny"
```

In HCP Terraform or Terraform Enterprise, Sentinel policies can run in the platform's policy phase after planning. In a self-managed CI pipeline, OPA-based tools often run as normal CI steps.

Development environments may warn on some rules while production blocks them. That does not mean production has different standards. It means the team may allow early feedback during development and enforce hard gates where blast radius is higher.

## Writing Rules Teams Can Live With
<!-- section-summary: Useful policies are specific, explain the fix, and focus on risks that automation can judge reliably. -->

Good policies have clear ownership and a clear fix. "Every managed resource must have `service`, `environment`, and `managed_by` tags" is specific. "Infrastructure must be good" cannot be automated.

Start with high-signal rules: required tags, public access blocks, encryption, protected destroy actions, approved regions, and broad IAM actions. Each denied message should name the resource address and the missing or risky value.

Avoid turning policy into a second hidden architecture document. If a rule exists, link it to a platform standard or security requirement. If engineers keep needing exceptions, inspect the rule. It may be too broad, or the platform may need a better paved path.

## Putting It All Together
<!-- section-summary: Policy as code works best when it reads evaluated plans, blocks clear production risks, and gives engineers actionable messages. -->

Policy as code makes Terraform review more reliable. Humans still read plans, but automation catches known risks every time. Plan JSON gives policy engines the evaluated resource values and actions they need.

For official reference, use Terraform's docs for [`terraform show -json`](https://developer.hashicorp.com/terraform/cli/commands/show), [`terraform plan`](https://developer.hashicorp.com/terraform/cli/commands/plan), [OPA policy language](https://www.openpolicyagent.org/docs/policy-language), and [Sentinel](https://developer.hashicorp.com/sentinel/docs).
