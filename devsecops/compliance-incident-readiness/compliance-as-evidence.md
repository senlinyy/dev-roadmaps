---
title: "Compliance as Evidence"
description: "Collect proof from normal engineering systems instead of creating audit work after the fact."
overview: "Compliance evidence should come from the same records engineers use to ship and operate software. This article maps pull requests, access reviews, deployment records, and incidents to control evidence."
tags: ["compliance", "evidence", "audit"]
order: 3
id: article-devsecops-compliance-incident-readiness-compliance-as-evidence
---

## Table of Contents

1. [What Evidence Proves](#what-evidence-proves)
2. [Engineering Records](#engineering-records)
3. [Control Mapping](#control-mapping)
4. [Access Evidence](#access-evidence)
5. [Evidence Gaps](#evidence-gaps)
6. [Putting It All Together](#putting-it-all-together)
7. [What's Next](#whats-next)

## What Evidence Proves

Compliance work asks whether a control exists and whether it operated. In a DevSecOps system, the best evidence often already exists in engineering tools: pull requests, workflow runs, deployment records, access reviews, scanner results, incident tickets, and audit logs.

The useful question is:

```text
Which normal engineering record proves this control operated?
```

If evidence has to be recreated manually after the fact, it is weaker and more expensive.

## Engineering Records

The orders service already creates many records.

| Engineering record | What it can prove |
|--------------------|-------------------|
| Pull request review | Code changes were reviewed before merge |
| Required checks | Tests and scans passed before merge |
| Workflow run | Build and deployment automation executed |
| Image digest | Exact artifact produced and deployed |
| Access review | Production access matched responsibility |
| Incident ticket | Response, containment, and follow-up were tracked |

The compliance task is to preserve and map these records, not to write separate stories that drift away from reality.

## Control Mapping

A control map connects a requirement to evidence.

```text
Control: production changes require review
Evidence source: pull request review and branch protection
Sample: PR #418, required checks passed, reviewer maya-dev
Owner: platform-team
Retention: 18 months
```

This record says what the control is, where evidence lives, which sample demonstrates it, who owns it, and how long it is retained.

A good control map is boring. Boring is good here because auditors and engineers can both follow it.

## Access Evidence

Access evidence should show who had access and why.

```text
Review: orders-api production access
Date: 2026-05-19
Deploy approvers: maya-dev, oren-platform
Log readers: orders-oncall
Cloud admins: platform-admins
Removed: sam-contractor
Exception: temporary DB read access for INC-418 until 2026-05-21
```

This proves that access was reviewed, old access was removed, and temporary access had an owner and expiry.

## Evidence Gaps

An evidence gap appears when a control may exist but cannot be proven.

| Gap | Example | Fix |
|-----|---------|-----|
| Missing approver | Deployment happened but no approval record | Use protected environments |
| Missing artifact digest | Release says `latest` | Record immutable digest |
| Missing access owner | Group contains unknown users | Add owner and review date |
| Missing incident closure | Ticket closed without follow-up evidence | Require closure checklist |

Fix evidence gaps in the system that creates the work. If deployments need digest evidence, add it to the deploy workflow. If access reviews miss owners, add owner fields to the identity source.

## Putting It All Together

Compliance evidence should come from normal engineering systems. Pull requests, checks, workflow runs, digests, access reviews, and incident tickets prove controls better than manually assembled summaries.

For `devpolaris-orders-api`, the control map should point to real records and retention rules. That makes audits less disruptive and makes engineering work easier to explain.

## What's Next

Evidence also matters during incidents. The next article shows how to classify, contain, investigate, communicate, and recover when a security event is active.

---

**References**

- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST describes secure development practices and evidence-oriented software work.
- [SOC 2 Trust Services Criteria overview](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services) - AICPA describes SOC reporting and trust services at a high level.
- [GitHub deployments and environments](https://docs.github.com/en/actions/reference/deployments-and-environments) - GitHub documents deployment records and environment protection evidence.
