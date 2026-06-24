---
title: "Compliance as Evidence"
description: "Map pull requests, scan outputs, approvals, deployment logs, and access reviews to audit-ready security evidence."
overview: "Compliance evidence is the proof a team already creates while building and shipping: pull requests, approvals, scan results, release records, access reviews, and incident notes. This article shows how to collect that proof without turning engineering into separate manual paperwork."
tags: ["devsecops", "compliance", "evidence", "audit"]
order: 1
id: article-devsecops-compliance-incident-readiness-compliance-as-evidence
---

## Table of Contents

1. [Why Evidence Comes From the Workflow](#why-evidence-comes-from-the-workflow)
2. [What Auditors Are Asking For](#what-auditors-are-asking-for)
3. [The Payments Portal Scenario](#the-payments-portal-scenario)
4. [Map Controls to Engineering Records](#map-controls-to-engineering-records)
5. [Pull Requests as Change Evidence](#pull-requests-as-change-evidence)
6. [Security Scans as Verification Evidence](#security-scans-as-verification-evidence)
7. [Releases, Deployments, and Approvals](#releases-deployments-and-approvals)
8. [Access Reviews and Separation of Duties](#access-reviews-and-separation-of-duties)
9. [Build an Evidence Packet for One Release](#build-an-evidence-packet-for-one-release)
10. [Keep Evidence Fresh Without Busywork](#keep-evidence-fresh-without-busywork)
11. [What's Next](#whats-next)

## Why Evidence Comes From the Workflow
<!-- section-summary: Compliance evidence should come from the same systems engineers already use to review, test, approve, and deploy software. -->

Compliance evidence is **proof that a control actually happened**. A control is a security or reliability expectation, like "production changes receive review before release" or "known vulnerable dependencies are assessed before deployment." Evidence is the record that lets another person verify the expectation without trusting a story from memory.

In a healthy DevSecOps workflow, evidence comes from ordinary delivery systems. Pull requests show who changed code and who reviewed it. CI logs show which tests and scans ran. Deployment records show which version reached production. Access reviews show who could approve, merge, deploy, and administer the service. The team gets audit proof from work they already do.

Here is the important shift. Compliance work should ask, "Which normal engineering record proves this?" before it creates a new spreadsheet. A spreadsheet can still help as an index, especially during an audit, but the strongest evidence usually lives in source control, CI/CD, ticketing, cloud logs, identity systems, and monitoring tools.

We will use one scenario through the whole Security Assurance submodule. The team owns **Northstar Payments**, a customer payment portal that stores saved payment methods, generates receipts, and sends settlement events to a finance system. The product matters because payment data creates real customer risk, and the portal ships often enough that manual evidence gathering would quickly drain the team.

## What Auditors Are Asking For
<!-- section-summary: Auditors usually want to see the control objective, the selected sample, the proof, and a clear link between all three. -->

An auditor rarely wants every log line your systems produced. They usually want a sample that proves a control operated during a period. For example, they might select five production releases from the last quarter and ask for proof that each release had code review, automated testing, vulnerability checks, approval, and deployment by an authorized pipeline.

The request has four parts. **The control objective** says what the organization promised to do. **The sample** names the release, pull request, access review, or incident chosen for inspection. **The evidence** contains the actual records. **The trace** links the records together so the reviewer can follow one change from request to production.

A weak answer sounds like a meeting recap: "We always require review and the team checks vulnerabilities." A strong answer points to records: pull request `#142`, commit `a81c0f2`, CI run `881245`, SBOM artifact `northstar-payments-2026.06.18.cdx.json`, release approval `REL-447`, production deploy `deploy-2026-06-18-2`, and the access review completed on `2026-06-20`.

That trace matters because compliance evidence needs chain of custody. Chain of custody means the evidence keeps enough context to show where it came from, who created it, and whether someone could have changed it after the fact. A screenshot pasted into a document loses much of that context. A signed artifact, a pull request event, a CI run URL, and an immutable deployment log carry much more detail.

## The Payments Portal Scenario
<!-- section-summary: A realistic release gives the article a concrete thread for showing how evidence appears across tickets, code, builds, scans, deployments, and access reviews. -->

Northstar Payments is preparing for a SOC 2 Type 2 audit and an internal mapping to NIST SSDF. SOC 2 is an audit report that examines controls related to service commitments such as security, availability, confidentiality, processing integrity, or privacy. NIST SSDF is a secure software development framework that describes practices for reducing software vulnerability risk across planning, development, verification, release, and response.

The release we will follow is `2026.06.18`, a change that adds step-up verification before customers update saved cards. The product manager created ticket `PAY-1842`. An engineer opened pull request `#142`. The CI pipeline ran unit tests, integration tests, SAST, dependency scanning, container scanning, and SBOM generation. A security reviewer approved the change because it touched authentication flow. The release manager approved production deployment after the pipeline passed.

This one release can answer several audit questions. It shows controlled change management, secure review, automated testing, vulnerability management, segregation of duties, artifact integrity, deployment approval, and production traceability. The team does not need eight separate evidence rituals for those eight ideas. It needs one clean path through records that already exist.

That path starts with mapping controls to the records the team can actually produce.

![Evidence trace infographic showing a Northstar Payments release flowing from ticket to pull request, CI checks, SBOM, release approval, deploy log, audit packet, and access review](/content-assets/articles/article-devsecops-compliance-incident-readiness-compliance-as-evidence/evidence-trace.png)

_The visual shows why one normal release can answer several evidence questions when each record keeps a stable link to the next record._

## Map Controls to Engineering Records
<!-- section-summary: A control map translates framework language into the exact delivery records a team can collect and review. -->

A **control map** connects a compliance requirement to proof from your workflow. Frameworks use broad language because they need to fit many organizations. Engineering systems produce specific records because they track real work. The map is the bridge between those two worlds.

Here is a small map for Northstar Payments. It uses NIST SSDF as the secure development anchor, but the same evidence can also support SOC 2 change management, ISO 27001 change control, or internal security policy. The key is to name the record once and reuse it where it honestly supports more than one control.

| Control need | Practical meaning for the team | Evidence source |
|---|---|---|
| Secure coding and review | Security-sensitive changes receive peer review and required checks before merge | Pull request review, branch protection, required status checks |
| Verify third-party components | Dependencies are scanned and known vulnerabilities are triaged before release | SCA report, SBOM, vulnerability ticket, triage decision |
| Protect release integrity | Build output comes from an approved commit and a controlled pipeline | CI run, artifact digest, provenance attestation, release record |
| Control production change | A release has an owner, approval, deployment record, and rollback path | Change ticket, deployment log, approval record, rollback note |
| Review privileged access | People who can merge, approve, deploy, or administer production are reviewed | Repository admin list, deployment approver group, access review export |

The map should stay small enough for engineers to use. A giant spreadsheet with every framework row can help a governance team, but a delivery team needs a short operational version. The engineering map says, "For this kind of release, these are the records we must preserve."

Northstar keeps this map in the security runbook and updates it when the workflow changes. If the team moves from one scanner to another, the control need stays the same, but the evidence source changes. That keeps the control tied to the behavior, not to one vendor button.

## Pull Requests as Change Evidence
<!-- section-summary: Pull requests can prove the business reason, code change, reviewer approval, required checks, and merge decision for a production change. -->

A **pull request** is one of the richest evidence records in a modern software team. It contains the proposed change, the linked ticket, discussion, reviewer decisions, commit history, required checks, merge timestamp, and the final commit that entered the protected branch. For a payment portal, this record explains why code changed before it reached production.

Northstar requires every production change to include a ticket link, a short risk note, at least one code owner review, and passing required checks. For authentication, payment handling, cryptography, logging, or authorization changes, the repository also requests a security reviewer. This keeps the process lightweight for normal edits and stricter for sensitive code.

The pull request body can carry the evidence index without turning into a form that nobody reads:

```markdown
## Change

PAY-1842 adds step-up verification before customers update saved cards.

## Security notes

- Touches customer authentication flow.
- Adds rate limiting for verification attempts.
- Updates integration tests for failed verification and expired session cases.

## Evidence

- CI run: 881245
- SBOM: northstar-payments-2026.06.18.cdx.json
- SCA report: dependency-scan-881245.sarif
- Deployment: deploy-2026-06-18-2
```

The repository settings should make the expected behavior enforceable. Required status checks and protected branches can require passing checks before merge. Code ownership can request reviews from the right group when sensitive paths change. A human reviewer still needs judgment, but the platform should prevent accidental bypass for the common path.

The team can export pull request evidence during an audit using the GitHub CLI or API. The exact fields vary by platform, but the idea stays the same: capture the record ID, reviewers, decision, commits, files, merge time, and check references.

```bash
mkdir -p evidence/release-2026.06.18
gh pr view 142 \
  --json number,title,author,reviewDecision,reviews,commits,files,mergedAt,baseRefName,headRefName,url \
  > evidence/release-2026.06.18/pr-142.json
gh pr checks 142 \
  > evidence/release-2026.06.18/pr-142-checks.txt
```

That export should supplement the live platform record rather than replace it. The best evidence packet includes links back to the original records, because reviewers often need to inspect timestamps, reviewer identities, and check conclusions directly.

## Security Scans as Verification Evidence
<!-- section-summary: Scan reports prove that verification ran, while triage records explain what the team did with findings. -->

Security scans create evidence for the verification part of delivery. **SAST** looks for risky patterns in source code. **SCA** checks third-party dependencies against known vulnerability data. Container scanning checks operating system packages and image layers. Secret scanning searches for leaked credentials. An **SBOM**, or software bill of materials, lists the components that make up the application.

Scan reports and triage records answer different questions. A scan report proves that a tool ran, while a triage record proves the team made a risk decision. If a dependency scan found a critical vulnerability and the pipeline still deployed, an auditor or security lead will ask what happened next. The answer needs a triage record, patch record, false-positive explanation, or approved exception.

Northstar stores scan outputs as workflow artifacts and keeps a short summary in the release evidence directory. The workflow names the evidence files consistently so the audit packet can find them later.

```yaml
name: payment-portal-security-evidence

on:
  pull_request:
  push:
    branches:
      - main

jobs:
  evidence:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test -- --ci
      - run: npm audit --audit-level=high --json > npm-audit.json
      - run: npx @cyclonedx/cyclonedx-npm --output-file sbom.cdx.json
      - uses: actions/upload-artifact@v4
        with:
          name: security-evidence
          path: |
            npm-audit.json
            sbom.cdx.json
```

This workflow is small on purpose. Real teams may use GitHub code scanning, OWASP Dependency-Check, OSV-Scanner, Trivy, Grype, Snyk, Semgrep, or commercial platforms. The compliance idea does not depend on a single tool. The evidence needs to show which scanner ran, which code or artifact it inspected, when it ran, what it found, and what decision followed.

For Northstar, a clean scan can attach directly to the release packet. A finding creates a vulnerability ticket linked to the pull request or release. That ticket moves us into the next article, where the team triages a serious vulnerable dependency and decides how fast to patch.

## Releases, Deployments, and Approvals
<!-- section-summary: Release evidence ties an approved commit to a build artifact, a deployment target, an approver, and a production timestamp. -->

A **release record** ties the engineering change to the production event. It answers a different question from the pull request. The pull request says, "This code change was reviewed and merged." The release record says, "This exact version was built, approved, and deployed to this environment."

For Northstar Payments, the release record includes the release version, commit SHA, artifact digest, workflow run, approver, deployment environment, timestamp, and rollback reference. The artifact digest matters because it identifies the built package or image by content, not by a friendly name that someone could reuse. A container image tag like `latest` makes weak evidence. A digest like `sha256:...` gives a stable identifier.

Artifact provenance adds another layer. **Provenance** describes where an artifact came from: repository, commit, workflow, build runner, and build time. SLSA and GitHub artifact attestations give teams standard ways to express and verify that build origin. In plain language, provenance helps the team prove that the artifact in production came from the approved pipeline and commit.

Northstar keeps release evidence in a change ticket, but the ticket links to the source records instead of copying everything into one place. A concise release ticket uses stable identifiers, so the reviewer can open each system of record directly.

| Field | Example |
|---|---|
| Release | `northstar-payments 2026.06.18` |
| Business ticket | `PAY-1842` |
| Pull request | `https://github.com/northstar/payments/pull/142` |
| Commit | `a81c0f2b7c1e4` |
| CI run | `881245` |
| Artifact digest | `ghcr.io/northstar/payments@sha256:7f2...` |
| Approval | `maya.singh`, release manager |
| Production deploy | `deploy-2026-06-18-2` |
| Rollback | `release-2026.06.11` |

This is enough for a reviewer to follow the chain. The reviewer can open the pull request, confirm the checks, inspect the workflow run, verify the artifact, and see the deployment event. The team avoids a giant document because every field points to a system of record.

## Access Reviews and Separation of Duties
<!-- section-summary: Evidence also needs to show who could approve, merge, deploy, and administer the systems that create the release record. -->

Software delivery evidence depends on access controls. If anyone can bypass branch protection, approve their own production deployment, or edit CI history, the evidence loses strength. That is why auditors often ask for **access review** records alongside release samples.

An access review checks whether the right people still have the right permissions. For Northstar, the review covers repository admins, code owners, deployment approvers, production cloud roles, CI/CD secrets administrators, and emergency break-glass accounts. The team reviews these because each role can affect the integrity of delivery evidence.

**Separation of duties** means one person should not control every step of a sensitive action. A small startup may not have a large approvals team, but it can still separate author, reviewer, and production approver for high-risk changes. In the payments portal, the engineer who writes the authentication change can request review, but a code owner reviews it and a release manager approves the production deployment.

The access review evidence needs more than a list of names. It should show the source of the access list, the reviewer, the decision, the removals, the exceptions, and the completion date. A practical review row looks like this:

| Access area | Source | Reviewer | Decision |
|---|---|---|---|
| `payments-admins` repository role | GitHub organization export | Engineering manager | Remove one former contractor |
| `payments-deploy-approvers` | Deployment environment settings | Release manager | Keep current members |
| `prod-payments-breakglass` | Cloud IAM export | Security lead | Keep two named custodians, rotate credentials |

This review connects back to release evidence. When release `2026.06.18` shows approval from `maya.singh`, the access review shows that Maya belonged to the approver group during the audit period. That gives the approval record context.

## Build an Evidence Packet for One Release
<!-- section-summary: A useful evidence packet indexes the original records, preserves exported artifacts, and explains any findings or exceptions. -->

An **evidence packet** is a small collection of links, exports, and notes for one sample. Think of it as an index that lets a reviewer inspect a release without asking the engineering team to hunt through tools live on a call. The packet should stay boring and repeatable.

Northstar creates one directory per sampled release during audit prep. The directory contains exported JSON or text for the key records, plus the scan artifacts and a short index file. The live links remain the primary source, and the exports help with retention and offline review.

```bash
mkdir -p evidence/release-2026.06.18

gh pr view 142 \
  --json number,title,author,reviewDecision,reviews,commits,files,mergedAt,url \
  > evidence/release-2026.06.18/pr-142.json

gh run view 881245 \
  --json databaseId,headSha,conclusion,createdAt,updatedAt,event,workflowName,url \
  > evidence/release-2026.06.18/workflow-881245.json

gh run download 881245 \
  --name security-evidence \
  --dir evidence/release-2026.06.18/security-evidence
```

The packet should also include a small manifest so the reviewer can see what was collected and whether any exported artifact changed later. A manifest works as a simple checksum index that makes the evidence folder easier to review.

```bash
find evidence/release-2026.06.18 -type f -print0 \
  | sort -z \
  | xargs -0 sha256sum \
  > evidence/release-2026.06.18/MANIFEST.sha256

gh api repos/northstar/payments/deployments \
  --jq '.[] | select(.sha == "a81c0f2b7c1e4") | {id, sha, environment, created_at, statuses_url}' \
  > evidence/release-2026.06.18/deployments-for-commit.json

gh api repos/northstar/payments/actions/runs/881245/artifacts \
  > evidence/release-2026.06.18/workflow-artifacts.json
```

The manifest gives the audit packet a clean final step: collect the original records, preserve the files, hash the packet, and keep links back to the systems of record. If the audit asks for a second sample later, the team can repeat the same sequence instead of inventing a new process.

The index file can be simple:

```markdown
# Evidence Packet: northstar-payments 2026.06.18

## Scope

Customer payment portal release for PAY-1842, deployed to production on 2026-06-18.

## Trace

- Ticket: PAY-1842
- Pull request: #142
- Commit: a81c0f2b7c1e4
- Workflow run: 881245
- Deployment: deploy-2026-06-18-2

## Controls Covered

- Change review before merge
- Required status checks before merge
- Dependency scan and SBOM generation
- Release approval before production deploy
- Deployment by controlled pipeline

## Notes

Dependency scan reported no critical or high findings for production dependencies.
```

The packet should also include the decision for every meaningful finding. If the scan found a vulnerable dependency, the evidence packet links to the vulnerability ticket. If the team accepted a temporary exception, the packet links to the exception record and its compensating controls. Evidence without decisions only proves that the team found something, not that it handled the risk.

![Evidence packet infographic showing release records, pull request exports, CI logs, scan reports, SBOM, artifact digest, and deploy approval collected into a reviewer-ready folder](/content-assets/articles/article-devsecops-compliance-incident-readiness-compliance-as-evidence/evidence-packet.png)

_The packet gives reviewers one place to start, while the links and exports still point back to the original systems of record._

## Keep Evidence Fresh Without Busywork
<!-- section-summary: Evidence stays healthy when teams automate collection, keep records close to the workflow, and review samples before audit season. -->

The hardest evidence problem is drift. A workflow changes, a scanner is replaced, a team renames an environment, or deployment approval moves to another tool. Six months later, the audit checklist still points to the old record. The fix is a lightweight evidence health check, not a quarterly panic.

Northstar reviews the evidence map after major workflow changes and samples one release each month. The sample asks a few practical questions. Can the team trace ticket to pull request to CI run to artifact to deployment? Are required checks visible? Are scan artifacts retained long enough? Are vulnerability decisions linked? Are production approvers still reviewed?

Automation helps, but it should collect evidence that people understand. A nightly job can export repository rules, deployment environment settings, and access membership. A release workflow can upload scan outputs and SBOMs. A dashboard can show releases missing evidence. The team still needs owners who know what the records mean and can explain them under review.

Good evidence work also improves security operations. The same trace that helps an auditor helps incident response. If a production bug appears after release `2026.06.18`, the team can quickly find the pull request, the changed files, the tests that ran, the dependency set, the deployer, and the rollback target. Compliance evidence turns into operational memory.

![Compliance evidence loop infographic showing control mapping, record capture, artifact preservation, access review, and audit answers around Northstar Payments](/content-assets/articles/article-devsecops-compliance-incident-readiness-compliance-as-evidence/compliance-evidence-loop.png)

_The summary loop shows the main habit: keep evidence close to delivery, then use the same trail for audit, security review, and incident follow-up._

## What's Next
<!-- section-summary: The next article uses the same release workflow to triage and patch a serious vulnerable dependency. -->

Northstar now has a clear evidence path for normal releases. The next problem starts when the evidence contains bad news: a dependency scanner finds a serious vulnerability in a component used by the payment portal.

The next article follows that alert through vulnerability triage and patching. We will use severity, exploitability, exposure, ownership, and patch deadlines to decide what the team needs to fix first and what proof it should keep.

---

**References**

- [NIST SSDF SP 800-218](https://csrc.nist.gov/pubs/sp/800/218/final)
- [NIST SP 800-53 Rev. 5, Security and Privacy Controls for Information Systems and Organizations](https://csrc.nist.gov/pubs/sp/800/53/r5/upd1/final)
- [GitHub Docs: About protected branches](https://docs.github.com/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)
- [GitHub Docs: About status checks](https://docs.github.com/articles/about-status-checks)
- [GitHub Docs: Workflow artifacts](https://docs.github.com/en/actions/concepts/workflows-and-actions/workflow-artifacts)
- [GitHub Docs: Artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations)
- [CycloneDX Specification Overview](https://cyclonedx.org/specification/overview/)
- [SLSA: Supply-chain Levels for Software Artifacts](https://slsa.dev/)
