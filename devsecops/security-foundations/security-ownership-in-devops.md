---
title: "Security Ownership"
description: "Decide who owns security decisions across application code, platform controls, production operations, and incident follow-up."
overview: "Security ownership means the people who build and operate a system can explain the risks they accept and the controls they maintain. This article uses open source maintainer cases and a production service example to make ownership practical."
tags: ["ownership", "reviews", "risk", "maintainers"]
order: 6
id: article-devsecops-security-foundations-security-ownership-in-devops
aliases:
  - security-ownership-in-devops
  - article-devsecops-security-foundations-security-ownership-in-devops
  - devsecops/security-foundations/security-ownership-in-devops.md
---

## Table of Contents

1. [What Is Security Ownership?](#what-is-security-ownership)
2. [Owners by Boundary](#owners-by-boundary)
3. [Decision Records](#decision-records)
4. [Review Paths](#review-paths)
5. [Case Study: event-stream](#case-study-event-stream)
6. [Ownership Failure Modes](#ownership-failure-modes)
7. [Putting It All Together](#putting-it-all-together)

## What Is Security Ownership?

Security ownership means someone is responsible for keeping a boundary understandable and healthy. The owner may not do every task personally. They are the person or team accountable for the rules, evidence, review path, and response when the boundary changes.

In a DevOps system, ownership is spread across several teams. Application engineers own application code and dependencies. Platform engineers own CI/CD foundations, runner configuration, cloud roles, and deployment paths. Security engineers help with threat modeling, detection, review standards, and incident response. On-call engineers own the immediate production reality when something breaks.

Shared ownership works when each boundary has a named owner. It fails when every team assumes another team is watching.

For `devpolaris-orders-api`, ownership should answer questions like these:

- Who reviews workflow permission changes?
- Who owns package publish configuration?
- Who owns runtime secret access?
- Who decides whether a vulnerability exception is acceptable?
- Who rotates a credential after a CI incident?
- Who signs off that an incident follow-up is complete?

If the answer is "the security team" for every question, the model is too vague. Security teams guide and verify, but the people closest to a system need to own many of the decisions because they understand how the system actually ships.

## Owners by Boundary

The easiest way to assign ownership is to follow the delivery trust model.

| Boundary | Primary owner | Support owner | Example responsibility |
|----------|---------------|---------------|------------------------|
| Application source | Orders team | Security | Review risky code and dependency changes |
| Workflow files | Platform team | Orders team | Keep untrusted PR jobs separate from trusted jobs |
| Package publishing | Platform team | Security | Control publish identity and provenance |
| Cloud deployment role | Platform team | Cloud security | Scope production deployment access |
| Runtime secrets | Orders team | Platform | Know which services consume each secret |
| Incident response | On-call lead | Security | Coordinate containment, evidence, and communication |

The `Primary owner` column names who should notice drift first. The `Support owner` column names who helps with specialized review. This distinction prevents both extremes: security decisions made by distant reviewers with no system context, and application decisions made without security expertise.

Ownership should be visible in the repository. `CODEOWNERS`, team names, runbook owners, secret owners, and service catalog entries all help. The point is not to create a perfect org chart. The point is to make the next change find the right people.

## Decision Records

Security decisions often involve tradeoffs. A team may accept a temporary vulnerability exception because the vulnerable code path is unreachable. A platform team may allow an emergency admin session because production is down. A service team may delay a dependency upgrade because the fix requires application changes.

Those decisions need short records.

```text
Decision: temporary exception for package example-lib CVE-2026-1234
Service: devpolaris-orders-api
Reason: vulnerable parser path is not used by the service
Compensating control: dependency is not reachable from user input
Expiry: 2026-06-19
Owner: orders-team
Reviewer: security-team
Follow-up: remove package during parser cleanup
```

The `Reason` line explains the judgment. `Compensating control` explains why the team believes the risk is bounded. `Expiry` prevents the exception from becoming permanent. `Owner` and `Reviewer` split system ownership from security review.

Without a record, the same discussion repeats every time the scanner reports the finding. With a record, the team can revisit the decision when evidence changes.

## Review Paths

Ownership should appear at the point where risky changes happen. Workflow permissions, deployment roles, package publishing, and production secrets deserve more careful review than ordinary application code.

```text
.github/workflows/release.yml       @platform-team @security-team
infra/production/iam/               @platform-team @cloud-security
src/payments/                       @orders-team @security-team
deploy/kubernetes/prod/             @platform-team @orders-team
runbooks/security/                  @security-team @oncall-leads
```

This `CODEOWNERS`-style map is small, but it changes behavior. A workflow permission change automatically reaches the platform and security reviewers. IAM changes reach cloud security. Payment code reaches the application and security reviewers.

Review paths should match risk. Requiring security review for every small text change teaches people to route around the process. Requiring the right review for boundaries that can change production keeps attention where it matters.

## Case Study: event-stream

In 2018, the npm ecosystem dealt with the `event-stream` incident. The package maintainer had transferred maintenance of a widely used package to another person. A malicious dependency was later introduced through that maintenance path and targeted a specific downstream application. npm's public writeup emphasized that the affected package was widely used and that the malicious code arrived through dependency and maintainer trust.

The lesson is ownership drift. A package can have millions of users while the real maintenance work depends on a very small number of people. When ownership changes, the trust model changes. Downstream teams may keep installing the package as if nothing changed because the package name is the same.

Read the path:

```text
trusted package name
  -> maintainer handoff
  -> new dependency
  -> downstream install
  -> targeted malicious behavior
```

For a consuming team, the control is not to personally audit every line of every dependency. The control is to notice ownership and dependency changes that affect important paths. Lockfiles, dependency review, maintainer health signals, SBOMs, and vulnerability intelligence all help turn a silent ownership change into a visible review event.

Map that back to `devpolaris-orders-api`. If a core package changes maintainers, adds a new install script, or introduces a new transitive dependency in a sensitive path, the application owner should know who reviews it. Dependency ownership is part of application ownership.

## Ownership Failure Modes

Ownership failures usually appear as missing names.

| Failure | What it looks like | Repair |
|---------|--------------------|--------|
| No workflow owner | Anyone can edit trusted release jobs | Add CODEOWNERS and required review for workflow paths. |
| No secret owner | Leaked secret has unknown consumers | Record owner, authority, consumers, and rotation path. |
| No exception owner | Vulnerability exception never expires | Add owner and expiry to every exception. |
| No package owner | Dependency changes merge without system context | Assign dependency review to the application team. |
| No incident owner | Response has many helpers and no coordinator | Name an incident lead for containment and evidence. |

The repair is usually simple. Name the owner where the change happens. Then make the owner visible in tooling so future changes reach them.

## Putting It All Together

Security ownership is the human layer of the delivery trust model. Tools can block, scan, sign, and log, but people decide which boundaries matter, which risks are accepted, and which controls are maintained.

For `devpolaris-orders-api`, ownership follows the path. The orders team owns application code and dependency choices. The platform team owns trusted workflow and deployment machinery. Security helps review high-risk changes and incident decisions. On-call leads own coordination when production is affected.

The event-stream case shows why this matters beyond one company. A trusted name can hide an ownership change. A healthy DevSecOps practice makes ownership changes, sensitive dependency changes, and production boundary changes visible before they become incidents.

---

**References**

- [npm: Details about the event-stream incident](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident) - npm describes the event-stream incident and how malicious code entered through dependency trust.
- [OpenSSF: XZ Backdoor CVE-2024-3094](https://openssf.org/blog/2024/03/30/xz-backdoor-cve-2024-3094/) - OpenSSF summarizes a maintainer and release-process supply-chain compromise.
- [GitHub CODEOWNERS documentation](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners) - GitHub documents file ownership and automatic review requests.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST frames secure software development as practices assigned to responsible roles and processes.
