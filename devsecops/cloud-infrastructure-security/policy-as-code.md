---
title: "Policy as Code"
description: "Turn repeated infrastructure review rules into tests that run in CI."
overview: "Policy as code makes security rules explicit and reviewable. This article explains plain-language rules, deny and warn behavior, policy tests, and how policies fit beside IaC scanners."
tags: ["policy", "opa", "review"]
order: 4
id: article-devsecops-cloud-infrastructure-security-policy-as-code
---

## Table of Contents

1. [What Policy as Code Does](#what-policy-as-code-does)
2. [Start With Plain Language](#start-with-plain-language)
3. [Deny, Warn, or Require Review](#deny-warn-or-require-review)
4. [Testing Policy](#testing-policy)
5. [Policy Evidence](#policy-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Policy as Code Does

Policy as code turns rules into code that can run during review. Instead of asking every reviewer to remember "admin ports must not be public," the team writes a policy that checks the Terraform plan.

For `devpolaris-orders-api`, a policy might say:

```text
Production admin listeners must not allow source 0.0.0.0/0.
```

That sentence is the real policy. The code exists to make the sentence testable.

Policy as code is useful when the same review comment repeats. If a rule is important, stable, and checkable from available evidence, automate it.

## Start With Plain Language

Write the policy in plain language first.

```text
Rule: production databases must not be publicly reachable.
Evidence needed: resource type, environment tag, public route or public ingress.
Allowed exception: temporary migration window with owner and expiry.
```

This step prevents clever policy code from hiding a vague rule. If the team cannot explain the rule plainly, it should not be automated yet.

The policy code can then check plan data, resource tags, network rules, or metadata.

```text
Input: Terraform plan JSON
Check: security group rule has environment=production and cidr=0.0.0.0/0
Output: deny with resource address and reason
```

## Deny, Warn, or Require Review

Not every policy should block.

| Mode | Use when | Example |
|------|----------|---------|
| Deny | The risk is clear and the false-positive rate is low | Public admin port in production |
| Warn | The pattern needs human context | Large private CIDR range |
| Require review | The change may be valid but sensitive | IAM role can assume another role |

The mode is part of the policy design. A noisy deny rule teaches teams to bypass the system. A weak warn rule may let serious changes pass unnoticed. Start with the risk and choose the behavior that fits.

## Testing Policy

Policy code should have tests. A broken policy can block safe work or allow unsafe work.

```text
Test: deny public admin ingress
Input: security group rule port 9000 source 0.0.0.0/0 env production
Expected: deny

Test: allow VPN admin ingress
Input: security group rule port 9000 source 10.40.20.0/24 env production
Expected: allow
```

Tests keep the policy tied to the intended behavior. They also help reviewers understand the rule without reading every line of policy code.

## Policy Evidence

CI output should explain policy decisions.

```text
Policy check: failed
Policy: no-public-admin-ingress
Resource: module.orders.aws_security_group_rule.admin
Reason: production admin port 9000 allows 0.0.0.0/0
Mode: deny
Fix: restrict source to VPN range or request exception
```

This is the message a developer needs. It names the policy, resource, reason, mode, and fix direction.

## Putting It All Together

Policy as code turns repeated review rules into tests. The strongest policies start as plain-language rules, use available evidence, choose the right mode, and produce output a developer can act on.

For `devpolaris-orders-api`, policy should cover high-confidence production risks: public admin ingress, broad IAM, missing encryption, missing audit logs, and production resources without owners. Sensitive but contextual changes can require review instead of automatic denial.

## What's Next

Policy checks review planned changes. Drift detection compares the desired infrastructure record with real cloud state after changes happen.

---

**References**

- [Open Policy Agent documentation](https://www.openpolicyagent.org/docs/latest/) - OPA documents policy as code and policy evaluation.
- [Conftest documentation](https://www.conftest.dev/) - Conftest documents testing configuration files with OPA policies.
- [Terraform plan JSON output](https://developer.hashicorp.com/terraform/internals/json-format) - HashiCorp documents machine-readable Terraform plan output.
