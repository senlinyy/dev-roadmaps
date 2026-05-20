---
title: "Break Glass Access"
description: "Design emergency production access with approval, time limits, audit logs, and cleanup."
overview: "Break glass access is rare emergency access for when normal paths cannot fix an incident fast enough. This article explains how to activate, use, close, and review privileged access without making it invisible."
tags: ["access", "incident", "audit"]
order: 6
id: article-devsecops-cloud-infrastructure-security-break-glass-access
---

## Table of Contents

1. [What Break Glass Means](#what-break-glass-means)
2. [The Emergency Path](#the-emergency-path)
3. [Activation](#activation)
4. [During the Session](#during-the-session)
5. [Closure](#closure)
6. [Putting It All Together](#putting-it-all-together)

## What Break Glass Means

Break glass access is emergency access for rare cases when normal production paths are unavailable or too slow. The name comes from emergency equipment behind glass: use it when needed, but every use should be visible.

For `devpolaris-orders-api`, normal changes go through pull request, Terraform, deployment approval, and audit logs. Break glass might be needed if the deployment system is down during an incident and an operator must change a cloud rule or restart a service directly.

Break glass access should have more evidence than normal access, not less. It is powerful because the situation is unusual.

## The Emergency Path

Design the emergency path before the emergency.

```text
Incident declared
  -> break glass request
  -> approval
  -> time-limited privileged session
  -> action logs
  -> access removed
  -> follow-up pull request
```

Each step has a job. The incident gives context. The request explains why normal access is not enough. Approval confirms the risk. The session gives temporary power. Logs record actions. Removal ends the power. The follow-up pull request brings infrastructure back into code.

## Activation

An activation record should be specific.

```text
Break glass request: BG-2026-05-19-01
Incident: INC-418
Requester: maya-dev
Approver: oren-platform
Reason: deployment workflow unavailable, production health checks failing
Access: production network admin
Duration: 60 minutes
Expected action: remove bad listener rule and restart orders-api
```

The `Duration` line is a control. The `Expected action` line gives reviewers something to compare with logs later.

## During the Session

Log every privileged action.

```json
{
  "time": "2026-05-19T11:14:03Z",
  "actor": "maya-dev-breakglass",
  "action": "securityGroup.revokeIngress",
  "resource": "orders-admin",
  "ticket": "INC-418",
  "result": "success"
}
```

The actor should make the emergency context visible. A separate emergency role or session name helps. The ticket connects the action to the incident. The result says whether the action worked.

Avoid mixing normal daily work into the emergency session. When the incident action is done, close the session.

## Closure

Closure proves the temporary power ended and any manual change became reviewable.

```text
Break glass request: BG-2026-05-19-01
Closed: 2026-05-19T11:52Z
Access removed: yes
Actions reviewed: yes
Manual changes codified: PR #422
Remaining risk: none
Reviewer: security-team
```

The `Manual changes codified` line matters. If the operator changed cloud state directly, Terraform or the normal configuration source must be updated or the change must be reverted. Otherwise break glass becomes permanent drift.

## Putting It All Together

Break glass access is a designed emergency path. It should be requested, approved, time-limited, logged, closed, and reviewed. It should create a stronger evidence trail than normal access because it bypasses normal controls.

For `devpolaris-orders-api`, break glass access exists for incidents where the normal deployment or Terraform path cannot act in time. Every use records the incident, requester, approver, role, duration, action logs, closure, and follow-up pull request.

---

**References**

- [NIST SP 800-61 Computer Security Incident Handling Guide](https://csrc.nist.gov/pubs/sp/800/61/r2/final) - NIST documents incident handling phases and evidence practices.
- [AWS IAM Identity Center temporary elevated access](https://docs.aws.amazon.com/singlesignon/latest/userguide/temporary-elevated-access.html) - AWS documents temporary elevated access concepts for emergency or time-bound access.
- [Microsoft privileged access strategy](https://learn.microsoft.com/en-us/security/privileged-access-workstations/privileged-access-strategy) - Microsoft documents privileged access planning and operational safeguards.
