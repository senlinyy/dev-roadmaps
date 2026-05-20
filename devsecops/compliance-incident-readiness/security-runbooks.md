---
title: "Security Runbooks"
description: "Write runbooks that give engineers clear checks, expected results, stop points, escalation triggers, and evidence requirements."
overview: "Security runbooks make recurring work repeatable without removing judgment. This article explains scope, expected results, escalation, automation boundaries, and testing."
tags: ["runbooks", "automation", "incidents"]
order: 5
id: article-devsecops-compliance-incident-readiness-security-runbooks
---

## Table of Contents

1. [What a Runbook Does](#what-a-runbook-does)
2. [Scope](#scope)
3. [Expected Results](#expected-results)
4. [Stop Points](#stop-points)
5. [Automation](#automation)
6. [Testing](#testing)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What a Runbook Does

A security runbook guides a repeated task. It should help an engineer gather evidence, make safe decisions, and know when to escalate. It should not hide judgment behind a list of commands.

For `devpolaris-orders-api`, useful runbooks include:

- triage a dependency finding
- rotate a leaked CI token
- review production access
- respond to a suspicious pod alert
- close a vulnerability exception

Each runbook should name the task, inputs, expected results, stop points, and evidence to save.

## Scope

Scope tells the reader when to use the runbook.

```text
Runbook: rotate leaked npm token
Use when: secret scanning confirms an npm token appeared in source, logs, or artifacts
Do not use when: malicious package executed in trusted CI with broad secrets present
Escalate instead: open security incident
```

The `Do not use when` line is important. Some situations are too broad for a routine runbook.

## Expected Results

Every step should have an expected result.

```text
Step: revoke the old npm token
Expected result: npm token list no longer shows the old token
Evidence: screenshot or command output attached to ticket
```

Expected results prevent false closure. Running a command is not enough. The runbook should say what success looks like.

## Stop Points

Stop points tell the engineer when to pause and escalate.

```text
Stop and escalate if:
- the token had organization-wide publish access
- malicious package execution is suspected
- production deploy credentials may have been exposed
- the old token cannot be revoked
```

Stop points protect against routine steps being applied to a non-routine incident.

## Automation

Automate checks that are safe and repeatable. Keep judgment visible.

```text
Good automation: list affected workflow runs
Good automation: check whether old token is revoked
Risky automation: automatically delete evidence logs
Risky automation: automatically close incident after rotation
```

Automation should gather evidence, reduce manual errors, and leave records. It should not remove evidence or make risk decisions silently.

## Testing

Runbooks need tests too. A tabletop exercise or dry run can reveal missing permissions, unclear steps, or outdated commands.

```text
Runbook test: leaked npm token rotation
Date: 2026-05-19
Result: token inventory step failed because token owner field was missing
Fix: add token owner to secret inventory
Owner: platform-team
```

Testing keeps runbooks alive. Untested runbooks become hopeful documents.

## Putting It All Together

Security runbooks make repeated security work easier to execute and easier to review. They need scope, expected results, stop points, evidence requirements, and tests.

For `devpolaris-orders-api`, runbooks should support triage, rotation, access review, runtime alerts, and incident closure. Each runbook should preserve judgment by saying when to escalate.

## What's Next

After an incident or repeated runbook failure, the team needs to harden the system so the same path is harder to repeat. That is post-incident hardening.

---

**References**

- [NIST SP 800-61 Computer Security Incident Handling Guide](https://csrc.nist.gov/pubs/sp/800/61/r2/final) - NIST documents incident handling preparation and response practices.
- [Google SRE Workbook: Incident Response](https://sre.google/workbook/incident-response/) - Google discusses incident response roles, process, and operational readiness.
