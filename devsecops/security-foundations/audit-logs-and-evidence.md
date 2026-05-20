---
title: "Audit Logs and Evidence"
description: "Use workflow records, audit logs, release artifacts, and access reviews to explain security and delivery decisions."
overview: "Audit evidence is the trail that connects source, identity, artifact, approval, and production behavior. This article teaches how to read that trail without turning delivery into paperwork."
tags: ["audit", "logs", "evidence", "incident-response"]
order: 5
id: article-devsecops-security-foundations-audit-logs-and-evidence
---

## Table of Contents

1. [What Counts as Evidence?](#what-counts-as-evidence)
2. [The Evidence Chain](#the-evidence-chain)
3. [Workflow Records](#workflow-records)
4. [Cloud and Runtime Logs](#cloud-and-runtime-logs)
5. [Release Evidence](#release-evidence)
6. [Case Study: CircleCI](#case-study-circleci)
7. [Evidence Gaps](#evidence-gaps)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Counts as Evidence?

Evidence is a record that helps a person answer a security question. In delivery work, the questions are usually concrete:

- Who changed the code?
- Who approved the change?
- Which workflow ran?
- Which identity acted?
- Which artifact was produced?
- Which environment changed?
- Which result did production report?

An audit log is evidence, but it is not the only evidence. Pull request reviews, workflow runs, image digests, deployment records, SBOMs, provenance statements, cloud activity logs, Kubernetes events, and incident notes can all be evidence.

The goal is to connect facts across systems. A workflow log alone may show that deployment started. A cloud audit log may show that a service updated. A release record ties them together so a human can say, "This pull request produced this artifact, this identity deployed it, and this service is now running it."

## The Evidence Chain

The evidence chain follows the delivery path from source to production.

```text
pull request
  -> review
  -> workflow run
  -> artifact digest
  -> deployment approval
  -> cloud or cluster update
  -> runtime health evidence
```

Each step should leave a record. The records do not need to be stored in one database, but they need stable identifiers that connect them. Commit SHA, pull request number, workflow run ID, artifact digest, deployment ID, cloud principal, and service name are the usual connectors.

Here is a compact evidence packet:

```text
Service: devpolaris-orders-api
Pull request: #418
Commit: 8f2a91d4c0b8
Reviewer: maya-dev
Workflow run: orders-api-delivery #1842
Artifact: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Environment: production
Deploy actor: orders-api-prod-deployer
Runtime result: /health returned 200
```

This packet is useful because it gives an investigator a path. If the health check failed, start with the artifact and deployment. If the deploy actor is wrong, inspect the workflow identity. If the artifact digest does not match the build output, inspect the registry and deploy script.

## Workflow Records

A workflow record should explain the automation context. The most useful fields are event, ref, actor, permissions, environment, and result.

```text
Workflow: orders-api-delivery
Run: #1842
Event: push
Ref: refs/heads/main
Actor: maya-dev
Permissions: contents:read, id-token:write, packages:read
Environment: production
Conclusion: success
```

The `Event` line tells you why the workflow started. `Ref` tells you which branch or tag it ran against. `Actor` tells you who caused the run. `Permissions` tells you what the token could do. `Environment` tells you whether deployment protection rules applied. `Conclusion` tells you whether the platform considered the run successful.

When a security incident involves CI, these fields are often more useful than the full log at first. They tell you whether the job ran from a fork, a protected branch, a tag, a manual dispatch, or a bot. They also show whether the job had permission to request identity or write to packages.

## Cloud and Runtime Logs

Cloud and runtime logs should name caller, action, target, time, source, and result.

```json
{
  "time": "2026-05-19T10:42:31Z",
  "caller": "orders-api-prod-deployer",
  "action": "service.update",
  "target": "orders-api-prod",
  "source": "github-actions/orders-api-delivery/1842",
  "result": "success"
}
```

`caller` is the identity that acted. `action` is the permission used. `target` is the resource changed. `source` connects the event back to the workflow. `result` says whether it worked.

If `source` is missing, the cloud event may still show what changed, but it is harder to connect the change to source review. If `caller` is a human admin during a normal deployment, the team should ask why the deploy role was bypassed. If `target` is broader than expected, the role may have too much reach.

## Release Evidence

Release evidence connects artifact identity with deployment intent. The most important artifact field is usually a digest.

```text
Release: orders-api 2026.05.19.1
Commit: 8f2a91d4c0b8
Image: ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
SBOM: orders-api-2026.05.19.1.spdx.json
Provenance: orders-api-2026.05.19.1.intoto.jsonl
Approved by: maya-dev
Deploy window: 2026-05-19 10:30-11:00 UTC
```

The digest tells you what ran. The SBOM tells you what components were inside. The provenance tells you how the artifact was built. The approval and deploy window explain the human decision around the change.

When a vulnerability is announced, release evidence shortens the investigation. Instead of asking every team whether they might be affected, you can search SBOMs, image digests, package versions, and deployment records.

## Case Study: CircleCI

CircleCI's January 2023 incident report described a security incident where an attacker accessed and exfiltrated data, including customer environment variables, tokens, and keys. CircleCI urged customers to rotate secrets stored in CircleCI and review logs for unauthorized access.

The case is useful because it shows how evidence and secrets meet. A CI provider can hold secrets for many customers. When that provider reports an incident, each customer needs to answer a local question:

```text
Which secrets did we store there, what could they access, and where is the evidence that we rotated them?
```

A team with good evidence can answer quickly. It has an inventory of CI secrets, the workflows that used them, the cloud roles or services they reached, and a rotation record. A team without evidence has to search old projects, guess which keys were active, and rotate under pressure.

Map this to the orders service:

```text
CI secret: legacy-cloud-deploy-key
Used by: old deploy workflow
Authority: update production service and read registry
Rotation status: replaced by OIDC role on 2026-05-19
Old key status: revoked
Evidence: cloud access key disabled event, workflow run #1842
```

The evidence does not make the incident pleasant. It makes it bounded.

## Evidence Gaps

An evidence gap is a missing field that stops investigation.

| Gap | Symptom | Fix |
|-----|---------|-----|
| No artifact digest | Production says `latest` | Deploy immutable digests and record them. |
| No workflow source | Cloud log has caller but no run ID | Add run ID and commit SHA to deploy metadata. |
| No secret inventory | Rotation starts with searching old jobs | Maintain secret owner, consumer, and authority records. |
| No reviewer record | Sensitive change merged with unclear approval | Use branch rules and CODEOWNERS on security paths. |
| No runtime version | App cannot report what it runs | Expose version, commit, and image digest in health or metadata. |

Evidence gaps are easier to fix before an incident. Add fields while the system is calm.

## Putting It All Together

Audit evidence is the delivery trust model written down as records. Source review, workflow context, artifact identity, deployment approval, cloud action, and runtime result each answer a different question.

For `devpolaris-orders-api`, the useful evidence chain is commit SHA, pull request, reviewer, workflow run, artifact digest, deploy actor, target service, and health result. Those fields let the team trace one production change without reading every log line first.

The CircleCI case shows why evidence matters outside normal deployments. When a provider or tool reports an incident, the local question becomes which secrets and workflows were exposed. An evidence inventory lets the team rotate and verify instead of guessing.

## What's Next

Evidence shows what happened. Ownership decides who maintains the path, who reviews sensitive changes, and who accepts risk when the answer is not automatic. The next article covers that shared responsibility.

---

**References**

- [CircleCI January 2023 incident report](https://circleci.com/blog/jan-4-2023-incident-report/) - CircleCI describes the incident, customer impact, and rotation guidance.
- [GitHub deployments and environments](https://docs.github.com/en/actions/reference/deployments-and-environments) - GitHub documents deployment records, protection rules, and environment secrets.
- [SLSA provenance specification](https://slsa.dev/spec/v1.0/provenance) - SLSA defines provenance fields that connect build inputs, builder, and artifact outputs.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST includes practices for preserving evidence and securing the development lifecycle.
