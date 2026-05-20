---
title: "Patch and Exception Workflows"
description: "Move security fixes and time-limited exceptions through source, build, deployment, verification, and evidence."
overview: "Patch workflows prove a risk was fixed in production. Exception workflows make temporary risk visible, owned, reviewed, and tied to follow-up evidence."
tags: ["patching", "exceptions", "risk"]
order: 2
id: article-devsecops-compliance-incident-readiness-patch-and-exception-workflows
---

## Table of Contents

1. [What a Patch Workflow Proves](#what-a-patch-workflow-proves)
2. [From Finding to Pull Request](#from-finding-to-pull-request)
3. [Production Proof](#production-proof)
4. [Exception Records](#exception-records)
5. [Putting It All Together](#putting-it-all-together)
6. [What's Next](#whats-next)

## What a Patch Workflow Proves

A patch workflow proves that a known risk was removed from the running system. Merging a pull request is not enough. The fixed artifact must be built, scanned, deployed, and verified.

For `devpolaris-orders-api`, the patch path is:

```text
finding
  -> owner
  -> pull request
  -> tests and scans
  -> new image digest
  -> production deployment
  -> closure evidence
```

The closure evidence should show the old affected artifact is no longer running.

## From Finding to Pull Request

A patch pull request should connect back to the finding.

```text
Finding: example-parser CVE-2026-1234
Change: update express and regenerate package-lock.json
Tests: request parser tests pass
Scan: dependency review passes
Owner: orders-team
```

The pull request should include the lockfile or image changes needed to prove the fix. If only `package.json` changes, reviewers may not know which version actually installs.

## Production Proof

After merge, prove production changed.

```text
Old image: ghcr.io/devpolaris/orders-api@sha256:1111...
New image: ghcr.io/devpolaris/orders-api@sha256:2222...
Fixed package: example-parser 1.4.4
Scanner result: CVE-2026-1234 absent
Deployment: production updated 2026-05-19T15:30Z
Health: /health returned 200
```

The new digest matters because production runs artifacts, not pull requests. The scanner result should apply to the new digest. The health check proves the service survived the patch.

## Exception Records

An exception is a decision to carry a known risk temporarily. It should be explicit, owned, and time-limited.

```text
Exception: CVE-2026-1234 in example-parser
Reason: vulnerable parser path is not reachable in orders-api
Compensating control: endpoint disabled and covered by route test
Owner: orders-team
Approved by: security-team
Expires: 2026-06-19
Follow-up: remove package during parser cleanup
```

The expiry date is the control that keeps an exception from becoming permanent. The follow-up turns the exception into work.

## Putting It All Together

Patch workflows and exception workflows both need evidence. A patch proves the fixed artifact reached production. An exception proves the team understood the risk, assigned an owner, and set a review date.

For `devpolaris-orders-api`, a finding closes when production runs a clean digest or when a time-limited exception is approved with compensating evidence. Anything else is still open work.

## What's Next

Patch and exception evidence can also serve compliance work. The next article shows how normal engineering records become audit evidence.

---

**References**

- [NIST SP 800-40 Rev. 4 Guide to Enterprise Patch Management Planning](https://csrc.nist.gov/pubs/sp/800/40/r4/final) - NIST documents patch management planning and risk-based remediation.
- [GitHub dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review) - GitHub documents dependency change review in pull requests.
- [Docker Scout](https://docs.docker.com/scout/) - Docker documents image vulnerability analysis and remediation evidence.
