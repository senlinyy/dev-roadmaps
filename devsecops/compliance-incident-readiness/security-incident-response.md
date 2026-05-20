---
title: "Security Incident Response"
description: "Classify, contain, investigate, communicate, recover, and preserve evidence during a security incident."
overview: "Incident response turns a confusing event into coordinated work. This article uses the Codecov and TanStack cases to explain containment, evidence, communication, recovery, and closure."
tags: ["incidents", "response", "forensics"]
order: 4
id: article-devsecops-compliance-incident-readiness-security-incident-response
---

## Table of Contents

1. [What Response Coordinates](#what-response-coordinates)
2. [Classify](#classify)
3. [Contain](#contain)
4. [Investigate](#investigate)
5. [Communicate and Recover](#communicate-and-recover)
6. [Case Studies: Codecov and TanStack](#case-studies-codecov-and-tanstack)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Response Coordinates

Security incident response coordinates people, evidence, and actions during an active security event. The team needs to understand what happened, stop ongoing harm, communicate clearly, restore safe service, and preserve enough evidence to learn afterward.

For `devpolaris-orders-api`, an incident may begin with a malicious package alert, leaked token, suspicious runtime behavior, or unexpected production change.

```text
signal
  -> classify
  -> contain
  -> investigate
  -> communicate
  -> recover
  -> harden
```

The order can overlap during real incidents. Containment may start before investigation is complete. Communication may begin while facts are still developing. The response lead keeps the work coordinated.

## Classify

Classification decides how serious the event is and who needs to join.

```text
Incident: INC-418
Signal: malicious package found in CI dependency install
Affected systems: orders-api release workflow
Possible exposure: npm token and cloud deploy identity
Severity: high
Incident lead: maya-dev
Security lead: oren-platform
```

Classification should say what is known and what is still uncertain. Avoid pretending certainty too early. If secrets may have been exposed, say "possible exposure" and investigate.

## Contain

Containment stops ongoing harm.

```text
Containment actions
- disable affected workflow
- revoke exposed token
- block affected package version
- pause production deployment
- preserve workflow logs
```

Containment actions should be logged. If a workflow is disabled, record who disabled it and why. If a token is revoked, record the old token authority and replacement plan.

## Investigate

Investigation connects evidence.

```text
Evidence to collect
- pull request and commit SHAs
- workflow run logs
- package install logs
- artifact digests
- registry publish events
- cloud audit logs
- runtime alerts
```

The goal is to answer scope: what ran, where it ran, what authority was present, what data or secrets may have been exposed, and what is still at risk.

## Communicate and Recover

Communication should separate facts, impact, actions, and next updates.

```text
Status update
Fact: malicious package executed in release workflow #1842
Impact: npm token may have been exposed
Action: token revoked, workflow disabled, replacement path in progress
Next update: 16:00 UTC
```

Recovery returns the system to safe operation. That may mean deploying a clean artifact, rotating credentials, restoring workflows, or rebuilding runners.

## Case Studies: Codecov and TanStack

Codecov's 2021 postmortem and TanStack's 2026 postmortem both show response patterns worth copying. Each involved a supply-chain path through developer or CI workflows. Each required scoping, customer or user guidance, credential rotation decisions, and follow-up hardening.

The lesson is that response evidence must answer local scope:

```text
Did we run the affected tool or package?
Which jobs had secrets present?
Which artifacts were produced afterward?
Which credentials need rotation?
Which users or customers need guidance?
```

For the orders service, those questions become searches through workflow runs, lockfiles, image digests, registry events, and secret inventories.

## Putting It All Together

Incident response coordinates classification, containment, investigation, communication, recovery, and hardening. The team should preserve evidence while stopping harm.

For `devpolaris-orders-api`, the response lead needs a small set of records: incident ID, signal, affected systems, possible exposure, containment actions, evidence collected, communication timeline, recovery proof, and follow-up work.

## What's Next

Runbooks make recurring response work easier without hiding judgment. The next article explains how to write security runbooks that guide engineers through checks, stop points, and escalation.

---

**References**

- [Codecov April 2021 postmortem](https://about.codecov.io/apr-2021-post-mortem/) - Codecov documents incident investigation, customer guidance, and response.
- [TanStack npm supply-chain compromise postmortem](https://tanstack.com/blog/npm-supply-chain-compromise-postmortem) - TanStack documents a 2026 npm supply-chain incident and response.
- [NIST SP 800-61 Computer Security Incident Handling Guide](https://csrc.nist.gov/pubs/sp/800/61/r2/final) - NIST documents incident response phases and evidence practices.
