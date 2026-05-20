---
title: "Drift Detection"
description: "Detect cloud changes that happen outside infrastructure code and decide whether to revert, import, or formalize them."
overview: "Drift is the difference between desired infrastructure and real infrastructure. This article explains desired state, real state, audit evidence, and the decisions teams make after drift appears."
tags: ["drift", "cloud", "detection"]
order: 5
id: article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection
aliases:
  - drift-and-misconfiguration-detection
  - article-devsecops-cloud-infrastructure-security-drift-and-misconfiguration-detection
  - devsecops/cloud-infrastructure-security/drift-and-misconfiguration-detection.md
---

## Table of Contents

1. [What Is Drift?](#what-is-drift)
2. [Desired State and Real State](#desired-state-and-real-state)
3. [Detecting Drift](#detecting-drift)
4. [Audit Logs](#audit-logs)
5. [Revert, Import, or Codify](#revert-import-or-codify)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Is Drift?

Drift is the difference between the infrastructure described in code and the infrastructure that exists in the cloud. It usually appears when someone changes a resource manually, an external system changes a setting, or a provider default changes after creation.

For `devpolaris-orders-api`, Terraform may say the admin port is closed, while the cloud console shows an emergency rule allowing access.

```text
Terraform: admin port denied
Cloud:     admin port allowed from VPN range
```

This difference may be a mistake. It may be a valid emergency change. It may be an attack. Drift detection starts the investigation.

## Desired State and Real State

Desired state is what the code says should exist. Real state is what the cloud provider reports now.

```text
Desired state
  -> Terraform files
  -> Terraform state
  -> reviewed pull requests

Real state
  -> cloud API
  -> resource configuration
  -> audit logs
```

Terraform state is a record of known managed resources. The cloud provider remains the source of real running configuration. Drift detection compares what Terraform expects with what the provider reports.

## Detecting Drift

A drift run should produce a clear record.

```text
Drift detected
Resource: aws_security_group_rule.orders_admin
Desired: absent
Actual: TCP 9000 allowed from 10.40.20.0/24
Detected by: terraform plan -refresh-only
Time: 2026-05-19T09:10Z
```

The `Desired` and `Actual` lines are the key. They tell the reviewer what changed. The `Detected by` line tells you whether this came from Terraform, a cloud security tool, or a custom check.

## Audit Logs

After drift appears, use audit logs to explain how it happened.

```json
{
  "time": "2026-05-19T08:31:44Z",
  "actor": "maya-dev",
  "action": "securityGroup.authorizeIngress",
  "resource": "orders-admin",
  "source": "cloud-console",
  "ticket": "INC-418"
}
```

The log shows actor, action, resource, source, and ticket. If the ticket exists and matches an incident, the drift may be an emergency change that needs to be formalized or reverted. If the actor is unknown or the source is unexpected, treat it as suspicious.

## Revert, Import, or Codify

There are three common decisions after drift.

| Decision | Use when | Result |
|----------|----------|--------|
| Revert | The real state is wrong or temporary | Cloud returns to desired state |
| Import | The resource should be managed by Terraform | State learns about existing resource |
| Codify | The manual change is correct and should persist | Terraform code changes to match intent |

Do not blindly run apply. If Terraform sees a manual change, applying may remove it. That may be correct, or it may break an active incident response workaround. Read the audit evidence first.

## Putting It All Together

Drift detection compares desired infrastructure with real infrastructure. It does not decide the answer by itself. The team still needs audit logs and context.

For `devpolaris-orders-api`, drift records should show desired state, actual state, who changed it, why it changed, and whether the team reverted, imported, or codified it. That keeps manual cloud changes from becoming invisible production architecture.

## What's Next

Sometimes the normal path is unavailable and someone needs emergency access. The final article in this module explains how to design break glass access without losing auditability.

---

**References**

- [Terraform plan refresh-only mode](https://developer.hashicorp.com/terraform/cli/commands/plan#refresh-only-mode) - HashiCorp documents using planning to inspect external changes to managed resources.
- [Terraform import documentation](https://developer.hashicorp.com/terraform/cli/import) - HashiCorp documents bringing existing infrastructure under Terraform management.
- [AWS CloudTrail user guide](https://docs.aws.amazon.com/awscloudtrail/latest/userguide/cloudtrail-user-guide.html) - AWS documents audit events for account activity.
