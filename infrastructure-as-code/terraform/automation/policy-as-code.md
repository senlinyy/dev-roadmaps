---
title: "Policy as Code"
description: "Enforce organization-wide infrastructure standards automatically using OPA and Sentinel so non-compliant configurations are blocked before they reach production."
overview: "Security policies written in a wiki get ignored. Policies enforced by code block the deploy. This article covers how to use Open Policy Agent (OPA) and HashiCorp Sentinel to write machine-readable rules that check Terraform plans against your organization's standards — before anything is applied."
tags: ["policy as code", "opa", "sentinel", "compliance", "terraform"]
order: 3
id: article-iac-terraform-automation-policy
---

## Table of Contents

1. [The Problem With Unenforceable Policies](#the-problem-with-unenforceable-policies)
2. [How Policy as Code Works With Terraform](#how-policy-as-code-works-with-terraform)
3. [Open Policy Agent: Writing Rules in Rego](#open-policy-agent-writing-rules-in-rego)
4. [Evaluating a Plan With OPA](#evaluating-a-plan-with-opa)
5. [Common Policy Patterns](#common-policy-patterns)
6. [HashiCorp Sentinel](#hashicorp-sentinel)
7. [Integrating Policy Checks Into CI/CD](#integrating-policy-checks-into-cicd)
8. [When Policies Block Valid Changes](#when-policies-block-valid-changes)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem With Unenforceable Policies

Every organization that manages cloud infrastructure eventually develops standards. No S3 buckets should have public access. All EC2 instances must have a `cost-center` tag. No security group should allow inbound traffic from `0.0.0.0/0` on port 22. Databases must have deletion protection and backup retention of at least seven days.

These rules are often written down — in a wiki, in a security policy document, in a Confluence page that was updated three years ago. Engineers are expected to read them and follow them. But documentation-based policy has a fundamental weakness: it only works when people remember to check it, and people are busy.

Infrastructure that violates policy gets deployed when an engineer is working quickly, when someone new joins the team and has not read the full documentation, when a temporary workaround gets forgotten and becomes permanent. Manual code review catches some of these issues, but reviewers also miss things, especially in large pull requests with many files.

Policy as code solves this by expressing the rules in machine-readable form and evaluating them automatically. The policy check runs in the CI/CD pipeline before any infrastructure is applied. A configuration that violates a policy fails the pipeline. The engineer sees a clear error message telling them exactly which rule failed and what they need to change. The policy cannot be forgotten or overlooked — it is enforced by the pipeline.

## How Policy as Code Works With Terraform

The flow is straightforward:

1. Terraform generates a plan that describes exactly what changes it intends to make.
2. The plan is converted to a machine-readable format (JSON).
3. A policy engine reads the plan JSON and evaluates it against a set of rules.
4. If any rule is violated, the pipeline fails and the apply does not proceed.
5. If all rules pass, the pipeline continues and the apply runs.

This works because the plan JSON is a structured description of the intended changes. Every resource to be created has the attributes Terraform can know at plan time. Every resource to be modified shows current and proposed values where Terraform can represent them. Some values may still be unknown until apply, and sensitive values may be redacted, so policy authors need to handle unknown and missing fields deliberately.

The two most common policy engines for Terraform are Open Policy Agent (OPA) with its Rego language, and HashiCorp Sentinel (which is part of the HCP Terraform platform). Both evaluate policies against the plan, but they differ in language syntax, integration approach, and cost.

## Open Policy Agent: Writing Rules in Rego

Open Policy Agent is an open-source, general-purpose policy engine. It uses a query language called Rego to express rules. Rego can look intimidating at first, but it follows a consistent pattern once you understand its basic structure.

A Rego policy is a collection of rules that define when something is allowed or denied. Here is a policy that blocks any plan that creates an S3 bucket unless the same plan also creates an enabled `aws_s3_bucket_versioning` resource for that bucket:

```rego
package terraform.policies.s3

import future.keywords.if
import future.keywords.in

deny[msg] if {
    bucket := input.resource_changes[_]
    bucket.type == "aws_s3_bucket"
    bucket.change.actions[_] == "create"

    bucket_name := bucket.change.after.bucket
    not versioning_enabled_for[bucket_name]

    msg := sprintf(
        "S3 bucket %s is created without enabled versioning",
        [bucket.address]
    )
}

versioning_enabled_for[bucket_name] if {
    versioning := input.resource_changes[_]
    versioning.type == "aws_s3_bucket_versioning"
    versioning.change.actions[_] == "create"
    bucket_name := versioning.change.after.bucket
    versioning.change.after.versioning_configuration[_].status == "Enabled"
}
```

Breaking this down:

`package terraform.policies.s3` declares a namespace for this policy file. Policies are organized by package, which lets you group related rules.

`deny[msg] if { ... }` defines a deny rule. The `deny` set collects all denial messages. If any rule in the `deny` set produces a message, the policy is violated. If the `deny` set is empty, the policy passes.

`bucket := input.resource_changes[_]` iterates over every resource change in the plan. `input` is the plan JSON. `resource_changes` is the list of all planned operations. `[_]` is Rego's way of saying "any index."

`bucket.type == "aws_s3_bucket"` filters to only S3 bucket resources.

`bucket.change.actions[_] == "create"` further filters to only resource changes that are creation operations.

`not versioning_enabled_for[bucket_name]` checks the helper rule. If the plan does not include an enabled versioning resource for the bucket, the denial is triggered.

`msg := sprintf(...)` constructs a human-readable error message that includes the resource address.

## Evaluating a Plan With OPA

To evaluate a Terraform plan against an OPA policy:

1. Generate and save the plan:
```bash
terraform plan -out=plan.tfplan
```

2. Convert the plan to JSON:
```bash
terraform show -json plan.tfplan > plan.json
```

3. Evaluate the plan against your policy using the OPA CLI:
```bash
opa eval \
  --input plan.json \
  --data policies/ \
  --format pretty \
  "data.terraform.policies[_].deny[_]"
```

This command evaluates the `deny` rules across all policy files in the `policies/` directory against the `plan.json` input. If any deny rules fire, their messages are printed and the command exits with a non-zero status, which causes the CI job to fail.

A helper script makes this cleaner:

```bash
#!/bin/bash
set -e

terraform plan -out=plan.tfplan
terraform show -json plan.tfplan > plan.json

VIOLATIONS=$(opa eval \
  --input plan.json \
  --data policies/ \
  --format raw \
  "[x | x := data.terraform.policies[_].deny[_]]")

if [ "$VIOLATIONS" != "[]" ]; then
  echo "Policy violations detected:"
  echo "$VIOLATIONS" | jq -r '.[]'
  exit 1
fi

echo "All policy checks passed"
```

## Common Policy Patterns

A few categories of policy rules come up in almost every organization.

On Azure, Policy as Code can also mean Azure Policy. Terraform and OPA/Sentinel checks run before apply, while Azure Policy evaluates requests at the Azure Resource Manager boundary. A `deny` policy can reject non-compliant resources even if someone bypasses Terraform and uses the portal or CLI. Many organizations use both layers: Terraform plan policies for fast feedback in CI, and Azure Policy for platform-level enforcement.

**Tagging requirements.** Every resource must have specific tags. Without automated enforcement, tags accumulate inconsistently — some resources have `environment`, others have `env`, some have neither. A policy rule that checks for required tags ensures consistent cost allocation and resource tracking.

```rego
required_tags := {"environment", "team", "cost-center"}

deny[msg] if {
    resource := input.resource_changes[_]
    resource.change.actions[_] == "create"

    existing_tags := {k | resource.change.after.tags[k]}
    missing_tags := required_tags - existing_tags
    count(missing_tags) > 0

    msg := sprintf(
        "Resource %s is missing required tags: %v",
        [resource.address, missing_tags]
    )
}
```

**No public S3 buckets.** An S3 bucket where `block_public_acls = false` is a common source of data exposure incidents. A production-ready policy should also catch buckets that have no companion `aws_s3_bucket_public_access_block` resource at all; the short example below focuses on the explicit false setting to keep the first rule readable.

```rego
deny[msg] if {
    resource := input.resource_changes[_]
    resource.type == "aws_s3_bucket_public_access_block"
    resource.change.actions[_] == "create"
    resource.change.after.block_public_acls == false

    msg := sprintf(
        "Resource %s does not block public ACLs. All S3 buckets must block public access.",
        [resource.address]
    )
}
```

**No unrestricted inbound access on port 22.** Opening SSH to the entire internet (`0.0.0.0/0`) is a common misconfiguration.

```rego
deny[msg] if {
    resource := input.resource_changes[_]
    resource.type == "aws_security_group"

    ingress := resource.change.after.ingress[_]
    ingress.from_port <= 22
    ingress.to_port >= 22
    "0.0.0.0/0" in ingress.cidr_blocks

    msg := sprintf(
        "Security group %s allows unrestricted inbound SSH access (0.0.0.0/0 on port 22). Use a specific CIDR range.",
        [resource.address]
    )
}
```

**Database backup retention.** RDS instances must have backup retention of at least seven days.

```rego
deny[msg] if {
    resource := input.resource_changes[_]
    resource.type == "aws_db_instance"
    resource.change.actions[_] == "create"
    resource.change.after.backup_retention_period < 7

    msg := sprintf(
        "RDS instance %s has backup retention of %d days. Minimum required is 7 days.",
        [resource.address, resource.change.after.backup_retention_period]
    )
}
```

## HashiCorp Sentinel

HashiCorp Sentinel is a policy framework that is tightly integrated with HCP Terraform (formerly Terraform Cloud). If your team uses HCP Terraform to run plans and applies, Sentinel is the native way to enforce policies.

Sentinel policies are written in the Sentinel language, which is more readable than Rego for engineers unfamiliar with datalog-style query languages. A Sentinel policy that enforces S3 versioning:

```hcl
import "tfplan/v2" as tfplan

s3_versioning_required = rule {
  all tfplan.resource_changes as _, rc {
    rc.type is not "aws_s3_bucket_versioning" or
    rc.change.after.versioning_configuration[0].status is "Enabled"
  }
}

main = rule {
  s3_versioning_required
}
```

Sentinel policies can be configured in HCP Terraform with one of three enforcement levels:

`advisory` — the policy is evaluated and results are visible, but a violation does not block the apply. Used for informational checks that you want to surface but not enforce yet.

`soft-mandatory` — a violation blocks the apply, but an authorized user can override the block and proceed. Used for rules that have legitimate exceptions.

`hard-mandatory` — a violation unconditionally blocks the apply. No override is possible. Used for absolute security requirements.

The enforcement level gives organizations a graduated path to policy adoption. You introduce a new policy at `advisory` to understand the violation rate, then move it to `soft-mandatory` once the common violations are resolved, and finally to `hard-mandatory` once you are confident the rule is correctly scoped.

## Integrating Policy Checks Into CI/CD

Policy checks belong in the CI/CD pipeline, and they should run before the apply — ideally as part of the same pipeline stage as `terraform plan`:

```yaml
- name: Terraform Plan
  run: terraform plan -out=plan.tfplan

- name: Convert Plan to JSON
  run: terraform show -json plan.tfplan > plan.json

- name: Run OPA Policy Checks
  run: |
    opa eval \
      --input plan.json \
      --data .policies/ \
      --fail-defined \
      "data.terraform.policies[_].deny[_]"
```

The `--fail-defined` flag tells the OPA CLI to exit with a non-zero status if the query returns any results — that is, if any deny rules fired. This integrates cleanly with CI systems that treat non-zero exit codes as failures.

Place the policy check step after `terraform plan` but before `terraform apply`. If any policy is violated, the pipeline fails at the policy check step, the apply step never runs, and the infrastructure is unchanged.

For teams using OPA, the policy files belong in version control alongside the Terraform configurations. The policies are code — they should be reviewed in pull requests just like configuration changes. When a security team adds a new policy rule, that change goes through the same review process as any other code change.

## When Policies Block Valid Changes

No set of policy rules is perfectly calibrated from the start. A new policy might block legitimate configurations that actually comply with the intent of the rule but not its literal expression. A security group that allows SSH only from a company VPN might be blocked by an overly broad rule that checks for any inbound rule on port 22 without checking the source CIDR.

There are several ways to handle legitimate exceptions.

**Fix the policy to be more precise.** The most sustainable option. If the rule is blocking a valid configuration, the rule is probably not capturing the correct intent. Refine it.

**Suppress the check for a specific resource.** OPA does not have built-in suppression annotations, but you can implement them using resource tags or comments. A resource tagged with `skip_policy_check = "approved-vpn-only-ssh"` can be excluded from the SSH check by adding a condition to the rule. This makes exceptions visible (they are in the code) and reviewable (they go through pull requests).

**Use `soft-mandatory` enforcement.** If you are using Sentinel, `soft-mandatory` lets authorized users override a policy violation with a documented justification. The override is recorded in HCP Terraform's audit log, so it is not invisible.

**Create an exception process.** Document how teams can request an exception, require a sign-off from a security team, and track exceptions in a register. This is heavier process, but appropriate for hard-mandatory rules where the stakes are high.

The goal is not perfect coverage from day one. It is to improve the signal-to-noise ratio over time — catching real violations while creating a clear, low-friction path for legitimate exceptions.

## Putting It All Together

Policy as code closes the gap between written standards and enforced standards. Instead of relying on engineers to remember the rules and reviewers to catch every violation, the rules are expressed in a language a computer can evaluate and checked automatically against every Terraform plan.

OPA with Rego works in any CI/CD system and is free and open-source. The plan JSON is the interface between Terraform and OPA — convert the plan to JSON, pass it to OPA, and evaluate your policy package against it. Violations produce messages that appear in CI logs with specific resource addresses and clear remediation guidance.

Sentinel integrates more tightly with HCP Terraform and offers a more readable policy language, enforcement levels, and override workflows. If your team is already using HCP Terraform, Sentinel is the natural choice.

Both approaches require the same organizational commitment: policies are code, reviewed in version control, evaluated before every apply. Infrastructure that violates the policy cannot be applied. Exceptions require explicit, documented decisions rather than silent workarounds.

## What's Next

You have now covered the complete Terraform roadmap — from what Terraform is and why it exists, through configuration, state, modules, environments, advanced techniques, and automation. The next step is applying these concepts to real infrastructure projects, iterating on your module library, and building the CI/CD and policy enforcement layer that makes infrastructure changes as safe and reviewable as application code.

---

**References**

- [Open Policy Agent](https://www.openpolicyagent.org) — Documentation for OPA, including the Rego language reference and the Terraform integration guide.
- [conftest (Open Policy Agent)](https://www.conftest.dev) — A command-line tool for testing configuration files using OPA policies, with built-in support for Terraform plan JSON.
- [Sentinel (HashiCorp)](https://developer.hashicorp.com/sentinel) — Documentation for HashiCorp Sentinel, including the policy language reference and enforcement level documentation.
- [Terraform Cloud Policy Sets (HashiCorp)](https://developer.hashicorp.com/terraform/cloud-docs/policy-enforcement) — How to configure and apply Sentinel policy sets in HCP Terraform.
- [Azure Policy Rule Structure (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/definition-structure-policy-rule) — Microsoft documentation for Azure Policy rule conditions.
- [Azure Policy Deny Effect (Microsoft Learn)](https://learn.microsoft.com/en-us/azure/governance/policy/concepts/effect-deny) — Microsoft documentation for platform-level deny enforcement.
