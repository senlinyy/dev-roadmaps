---
title: "Post-Incident Hardening"
description: "Turn incident lessons into controls, tests, ownership, evidence, and reviewable engineering changes."
overview: "Post-incident hardening proves the team learned from an event. This article explains how to turn facts into fixes, avoid vague action items, and verify that the same path is harder to repeat."
tags: ["hardening", "learning", "controls"]
order: 6
id: article-devsecops-compliance-incident-readiness-post-incident-hardening
---

## Table of Contents

1. [What Hardening Changes](#what-hardening-changes)
2. [Facts to Actions](#facts-to-actions)
3. [Controls You Can Test](#controls-you-can-test)
4. [Ownership](#ownership)
5. [Verification](#verification)
6. [Putting It All Together](#putting-it-all-together)

## What Hardening Changes

Post-incident hardening changes the system after the facts are understood. It should reduce the chance of the same path working again, reduce blast radius, or improve detection and response.

For `devpolaris-orders-api`, a post-incident review may find that a malicious package ran in CI with too many secrets present. The hardening should change the workflow, secret exposure, dependency review, and detection evidence.

```text
Incident fact
  -> broken boundary
  -> hardening action
  -> test
  -> owner
  -> verification
```

## Facts to Actions

Start with facts, not blame.

```text
Fact: pull request job restored a cache later used by release
Broken boundary: untrusted state reached trusted job
Action: separate cache scope by event and trusted ref
Test: fork PR cache cannot be restored by release job
Owner: platform-team
```

This action is useful because it names the broken boundary and a test. "Improve CI security" would be too vague.

## Controls You Can Test

Hardening should produce controls that can be verified.

| Incident fact | Hardening control | Verification |
|---------------|-------------------|--------------|
| Token exposed in log | Redact and remove token from job | Secret scanning and log review pass |
| Mutable action tag used | Pin action to full commit SHA | Workflow lint detects mutable tags |
| Public admin rule added manually | Policy blocks public admin ingress | Policy test rejects sample plan |
| Exception never expired | Exceptions require expiry date | CI rejects exception without expiry |

The verification column keeps hardening from becoming a promise.

## Ownership

Every hardening item needs an owner and due date.

```text
Action: pin third-party actions in release workflows
Owner: platform-team
Due: 2026-05-26
Verification: workflow policy passes and PR #428 merged
Status: open
```

If no team owns the action, it is not real work yet.

## Verification

Close hardening with evidence.

```text
Hardening item: separate PR and release cache scopes
Pull request: #428
Test: fork PR cache restore blocked in release workflow
Workflow run: hardening-validation #1902
Result: passed
Closed by: security-team
```

This record proves the control exists and was tested. It also gives future reviewers a place to start when the workflow changes again.

## Putting It All Together

Post-incident hardening turns lessons into tested controls. The strongest actions name the incident fact, broken boundary, control, owner, due date, and verification evidence.

For `devpolaris-orders-api`, hardening should improve the delivery path after every meaningful event: narrower tokens, clearer workflow boundaries, better scanner gates, stronger policy tests, more useful runbooks, and evidence that the change actually works.

---

**References**

- [TanStack incident follow-up](https://tanstack.com/blog/incident-followup) - TanStack describes hardening actions after its npm supply-chain compromise.
- [Codecov April 2021 postmortem](https://about.codecov.io/apr-2021-post-mortem/) - Codecov documents post-incident guidance and response after the Bash Uploader compromise.
- [NIST SP 800-61 Computer Security Incident Handling Guide](https://csrc.nist.gov/pubs/sp/800/61/r2/final) - NIST documents post-incident activity as part of incident response.
