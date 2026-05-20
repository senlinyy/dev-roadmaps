---
title: "IaC Security Scanning"
description: "Scan Terraform and other infrastructure code for risky configuration before cloud APIs apply it."
overview: "Infrastructure-as-code scanning reads files and plans before resources change. This article explains what scanners can see, how to review findings, and how to keep suppressions accountable."
tags: ["iac", "terraform", "scanning"]
order: 3
id: article-devsecops-cloud-infrastructure-security-iac-security-scanning
---

## Table of Contents

1. [What IaC Scanning Reads](#what-iac-scanning-reads)
2. [File Scans and Plan Scans](#file-scans-and-plan-scans)
3. [Reading a Finding](#reading-a-finding)
4. [Suppressions](#suppressions)
5. [CI Evidence](#ci-evidence)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What IaC Scanning Reads

Infrastructure-as-code scanning reads configuration before a cloud provider applies it. In Terraform, a scanner may read `.tf` files, module inputs, rendered plans, or state-derived context depending on the tool.

For `devpolaris-orders-api`, the scanner should catch risky patterns such as:

- public ingress to admin ports
- wildcard IAM actions
- unencrypted storage
- public buckets
- missing logging
- overly permissive security group rules

The scanner gives evidence for review. It does not understand every business reason. It may also miss provider defaults that only appear after planning.

## File Scans and Plan Scans

A file scan reads source files.

```hcl
resource "aws_security_group_rule" "admin" {
  type        = "ingress"
  from_port   = 9000
  to_port     = 9000
  protocol    = "tcp"
  cidr_blocks = ["0.0.0.0/0"]
}
```

This is easy for a scanner to flag because the broad CIDR is visible in the file.

A plan scan reads the proposed changes after variables and modules are resolved.

```text
+ admin rule
  from_port: 9000
  cidr:      0.0.0.0/0
  target:    orders-api-admin
```

Plan scans can catch risks hidden behind module inputs. File scans are faster and simpler. Use both where possible: file scans for quick feedback and plan scans for review of the actual proposed change.

## Reading a Finding

A useful IaC finding should say the resource, rule, evidence, and fix direction.

```text
Rule: public-ingress-admin-port
Resource: aws_security_group_rule.admin
Evidence: cidr_blocks includes 0.0.0.0/0 and port 9000
Severity: high
Fix: restrict source to corporate VPN range
Owner: platform-team
```

The resource tells you where to look. The evidence tells you why the scanner flagged it. The fix direction gives the reviewer a path.

Avoid fixing scanner output by changing names or moving code around. The cloud behavior is what matters.

## Suppressions

Sometimes a finding is accepted. The suppression should explain why.

```hcl
# checkov:skip=CKV_AWS_EXAMPLE: public HTTP listener is the intended internet entry point
resource "aws_lb_listener" "public_http" {
  port = 80
}
```

Suppressions need owners and review. A suppression with no reason is a hidden exception. A suppression with an expiry date is better when the risk is temporary.

```text
Suppression: public HTTP listener
Reason: internet entry point redirects to HTTPS
Owner: platform-team
Review again: 2026-08-19
```

## CI Evidence

The CI output should make the finding easy to review.

```text
IaC scan: failed
Tool: checkov
Resource: aws_security_group_rule.admin
Rule: no public admin ingress
File: infra/prod/network.tf:42
Decision: block merge
```

This is enough for a pull request reviewer to understand why the check failed. The next step is to change the infrastructure code or record a justified exception.

## Putting It All Together

IaC scanning turns infrastructure mistakes into review evidence before cloud APIs apply them. File scans catch visible patterns. Plan scans catch resolved changes. Findings need resource, evidence, severity, owner, and fix direction.

For `devpolaris-orders-api`, scanner findings should block high-risk public exposure, broad IAM, missing encryption, and missing logging. Suppressions should be reviewed security decisions, not a way to quiet the tool.

## What's Next

Scanners catch known patterns. Policy as code turns your team's recurring security rules into tests that match local architecture and risk.

---

**References**

- [Checkov documentation](https://www.checkov.io/) - Checkov documents scanning Terraform and other infrastructure-as-code formats.
- [tfsec documentation](https://aquasecurity.github.io/tfsec/) - tfsec documents Terraform security scanning.
- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan) - HashiCorp documents Terraform plans as proposed infrastructure changes.
