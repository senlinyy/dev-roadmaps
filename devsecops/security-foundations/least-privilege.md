---
title: "Least Privilege"
description: "Give people, workflows, and services only the access they need, with enough evidence to review and repair mistakes."
overview: "Least privilege is the access model behind safe delivery. This article walks through actors, permissions, targets, role scope, and a cloud breach case study so access feels concrete instead of theoretical."
tags: ["iam", "permissions", "least-privilege", "cloud"]
order: 3
id: article-devsecops-security-foundations-least-privilege
---

## Table of Contents

1. [What Is Least Privilege?](#what-is-least-privilege)
2. [Read Access as a Sentence](#read-access-as-a-sentence)
3. [Human Access](#human-access)
4. [Workflow Access](#workflow-access)
5. [Service Access](#service-access)
6. [Case Study: Capital One](#case-study-capital-one)
7. [When Access Fails](#when-access-fails)
8. [Review Evidence](#review-evidence)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is Least Privilege?

Least privilege means an actor receives the smallest useful access for the job it is doing. The actor can be a person, a CI job, a deploy role, a running service, a Kubernetes service account, or a break glass administrator. The job might be reading logs, publishing an image, deploying one service, or reading one secret.

The phrase is common enough that it can lose meaning. Make it concrete by asking four questions:

```text
Who is acting?
What action are they allowed to take?
Which resource can they touch?
How long should that access last?
```

If one of those answers is broad, the privilege is broad. "The deploy role can update the orders service for one hour" is narrow. "The CI user is admin in production" is broad. "Developers can read production logs during on-call shifts" is narrower than "all engineers can read everything forever."

Least privilege keeps the normal path clear and makes unusual power visible. If an engineer needs emergency access, the team should design an emergency path with approval, time limits, and audit evidence instead of hiding an admin key in a wiki.

## Read Access as a Sentence

Access policies are easier to review when you turn them into sentences. A cloud IAM policy, GitHub permission, or Kubernetes role may have provider-specific syntax, but the sentence underneath is the same.

```text
orders-api-prod-deployer can update service orders-api-prod in production.
```

That sentence has an actor, permission, target, and environment. Now compare it with a broad sentence:

```text
ci-admin can do anything in the production account.
```

The broad sentence is easy to write as a policy because most platforms have an administrator role. It is hard to defend because any compromise of that one identity becomes a compromise of many resources.

Here is a review table for the orders service.

| Actor | Useful permission | Target | Why it is enough |
|-------|-------------------|--------|------------------|
| `orders-api-prod-deployer` | Update service | `orders-api-prod` | Deployment should change the service, not the whole account. |
| `orders-api-log-reader` | Read logs | Orders log group | On-call needs evidence, not write access. |
| `orders-api-runtime` | Read secret | Orders database credential | The app needs its own credential, not every secret. |
| `platform-admin` | Manage deployment roles | Platform account only | Platform maintains access boundaries. |
| `break-glass-admin` | Emergency admin | Time-limited production session | Rare response path with explicit evidence. |

The `Why it is enough` column matters. A least privilege review should explain how work still happens after broad access is removed.

## Human Access

Human access follows responsibility. A developer reviewing normal application code may need repository write access. An on-call engineer may need production log access. A platform engineer may need to change deployment roles. Those are different jobs, so they should not all receive the same production admin role.

The simplest access review artifact looks like this:

```text
Review: devpolaris-orders-api production access
Date: 2026-05-19
Application maintainers: orders-team
Production log readers: orders-oncall
Deploy approvers: maya-dev, oren-platform
Cloud admins: platform-admins
Removed: sam-contractor
Exception: temporary database read access for incident INC-418 until 2026-05-21
Owner: maya-dev
```

Read it line by line. The review names the service and date. It separates maintainers from log readers, deploy approvers, and cloud admins. It records a removal. It records a temporary exception with an owner and expiry date.

The expiry date is not paperwork. It is the control that keeps temporary access from becoming permanent access. Many production environments become risky because old access is never removed. The review should compare current access with current work, then remove access that no longer has a job.

## Workflow Access

CI/CD workflows need their own least privilege review because machines can act faster than people. A job that runs on every pull request should have less power than a job that deploys after approval.

```yaml
permissions:
  contents: read

jobs:
  test:
    permissions:
      contents: read

  deploy-prod:
    if: github.ref == 'refs/heads/main'
    environment: production
    permissions:
      contents: read
      id-token: write
      packages: read
```

The top-level `contents: read` creates a safe default. The test job repeats that read-only shape. The deploy job asks for `id-token: write` because it needs short-lived cloud identity, and it sits behind a production environment boundary.

The common mistake is to start with `write-all` because one step failed. That hides the real problem. If package download failed, add package read access. If cloud deployment failed, check the exact cloud action and resource. If approval blocked the run, fix the environment rule. Broadening the whole workflow makes the next incident harder to contain.

## Service Access

Runtime services also need narrow access. The orders service may need to read its database password, write application logs, and call one payment API. It should not be able to list every secret, change IAM roles, or read unrelated databases.

Here is a small service access map.

| Runtime action | Resource | Access shape |
|----------------|----------|--------------|
| Read database credential | `orders/prod/database-url` | Read one secret version |
| Write logs | Orders log stream | Create log event |
| Read feature flags | Orders config path | Read-only config access |
| Call payment API | Payment endpoint | Scoped API token |

Runtime access should also be tied to the workload identity. In Kubernetes, that may be a service account. In a cloud service, it may be a managed identity or role. The important idea is the same: production code should not depend on a human's personal credential.

## Case Study: Capital One

In 2019, Capital One disclosed a cloud data incident. Public information from Capital One and the U.S. Department of Justice describes unauthorized access to data connected to a cloud-hosted application and misconfigured infrastructure. The case is often discussed because it connected application exposure, cloud access paths, and the permissions available to the role reached through that path.

For this article, the lesson is the blast radius of an identity. A vulnerable or misconfigured entry point is serious. It becomes much worse when the identity reachable from that entry point can access broad data. Least privilege cannot make every application bug disappear, but it can reduce what one compromised path can reach.

Read the case as a path:

```text
external request
  -> application or edge misconfiguration
  -> cloud metadata or role path
  -> temporary credentials
  -> storage data
```

The least privilege review has two questions: how the request got in, and what the reached identity could read afterward. Both questions matter. Network exposure and IAM scope work together.

Map that back to `devpolaris-orders-api`. If the service has a server-side request bug, the runtime identity should still be narrow. It may need one database credential and one log path. It should not be able to read every object bucket, list all secrets, or assume deployment roles.

## When Access Fails

Least privilege creates permission errors. That is normal. The fix is to read the denied action carefully, then add the narrow permission that matches the intended job.

```text
AccessDenied
Actor: orders-api-prod-deployer
Action: service.update
Resource: orders-api-prod
Reason: role policy does not allow service.update on this resource
```

The useful fields are `Actor`, `Action`, `Resource`, and `Reason`. If the actor is wrong, the workflow is using the wrong identity. If the action is wrong, the policy is missing the needed operation. If the resource is wrong, the workflow is targeting the wrong service or environment.

The unsafe fix is:

```text
Grant production admin to orders-api-prod-deployer.
```

The safer fix is:

```text
Allow service.update on orders-api-prod for the deploy workflow identity.
```

That second fix matches the original sentence. It gives the actor the action on the target it needs.

## Review Evidence

A least privilege review should leave behind enough evidence to answer why access exists.

```text
Access decision: orders-api-prod-deployer
Allowed action: service.update
Allowed target: orders-api-prod
Denied targets: databases, IAM roles, unrelated services
Reason: production deployment from approved workflow
Expiry: none, normal deployment path
Reviewer: platform-team
Last tested: workflow run #1842
```

This record does not replace the provider policy. It explains the intent behind it. When someone later asks for broader access, the team can compare the request with the intent.

## Putting It All Together

Least privilege is the permission layer of the delivery trust model. Start by writing access as a sentence: actor, action, target, duration. Then check whether the real policy matches the sentence.

For the orders service, people, workflows, and runtime services each get different access because they do different jobs. Human access follows responsibility. Workflow access follows the delivery step. Service access follows what the running app must read or write.

The Capital One case shows why this matters during real incidents. When an entry point fails, the permissions behind that entry point decide how far the incident can spread. Narrow roles give the team fewer places to check and fewer secrets or data stores to rotate afterward.

## What's Next

Least privilege narrows who can act. The next article covers secrets, the sensitive values that let actors prove who they are. Secrets need storage, delivery, rotation, and removal paths that match the same trust model.

---

**References**

- [Capital One 2019 cyber incident facts](https://www.capitalone.com/digital/facts2019/) - Capital One summarizes the 2019 incident, affected data categories, and response.
- [U.S. Department of Justice announcement on the Capital One data theft case](https://www.justice.gov/usao-wdwa/pr/seattle-tech-worker-arrested-data-theft-involving-large-financial-services-company) - DOJ describes the arrest and alleged unauthorized access path.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - GitHub documents how workflows can use short-lived federated identity instead of long-lived cloud secrets.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST includes access control and secure development practices that support least privilege.
