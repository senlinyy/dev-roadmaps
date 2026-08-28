---
title: "Least Privilege and Secrets"
description: "Learn how delivery teams limit access for people, services, and CI jobs while replacing long-lived secrets with scoped, rotated, and temporary credentials."
overview: "Follow ParcelPulse from repository to production and reduce compromised-access risk across four dimensions: privilege, scope, lifetime, and exposure. Separate human and workload identities, keep secrets out of source and artifacts, design rotation, use narrow OIDC federation, and verify actual access continuously."
tags: ["devsecops", "least-privilege", "secrets", "oidc"]
order: 2
id: article-devsecops-security-foundations-least-privilege
aliases:
  - least-privilege
  - article-devsecops-security-foundations-least-privilege
  - devsecops/security-foundations/least-privilege.md
  - secrets-management-basics
  - article-devsecops-security-foundations-secrets-management-basics
  - devsecops/security-foundations/secrets-management-basics.md
  - devsecops/security-foundations/02-least-privilege-and-secrets.md
  - devsecops/security-foundations/02-least-privilege-and-secrets
  - security-foundations/02-least-privilege-and-secrets
---

## Table of Contents

1. [How Do Least Privilege and Secret Management Reduce the Same Risk?](#how-do-least-privilege-and-secret-management-reduce-the-same-risk)
2. [How Do You Derive Access from One Exact Job?](#how-do-you-derive-access-from-one-exact-job)
3. [Why Should Humans, Workloads, and Environments Have Separate Identities?](#why-should-humans-workloads-and-environments-have-separate-identities)
4. [What Makes a Static or Exposed Secret Dangerous?](#what-makes-a-static-or-exposed-secret-dangerous)
5. [How Should a Secret Manager and Rotation Lifecycle Work?](#how-should-a-secret-manager-and-rotation-lifecycle-work)
6. [How Does OIDC Replace Permanent CI Credentials?](#how-does-oidc-replace-permanent-ci-credentials)
7. [How Do You Verify Access and Respond to a Leaked Secret?](#how-do-you-verify-access-and-respond-to-a-leaked-secret)
8. [How Do You Build an End-to-End Least-Privilege Delivery Path?](#how-do-you-build-an-end-to-end-least-privilege-delivery-path)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Least privilege and secrets management begin with one question: if an identity is compromised, what can the attacker do, where can they do it, how long will the access work, and how easily can defenders stop it?

A compact model is:

```text
compromised-access risk
  ~= privilege x resource scope x lifetime x exposure
```

The factors reinforce one another. A broadly privileged secret copied into several systems and valid for years is dangerous along every dimension. A short-lived credential that can update one service from one approved workflow produces a much smaller attack window and blast radius.

DevSecOps makes this model important because delivery systems contain many identities: developers, reviewers, CI runners, deployment workflows, applications, containers, cloud services, backup jobs, and automation. Each needs access, yet their jobs differ.

Follow ParcelPulse, a delivery service moving from source to a production API, database, and message queue:

```text
developer -> repository -> CI runner -> registry -> deployment pipeline
                                                 -> production API
                                                 -> database
                                                 -> message queue
```

Keep these questions in view as you work through the lesson:

1. **How Do Least Privilege and Secret Management Reduce the Same Risk?**
2. **How Do You Derive Access from One Exact Job?**
3. **Why Should Humans, Workloads, and Environments Have Separate Identities?**
4. **What Makes a Static or Exposed Secret Dangerous?**
5. **How Should a Secret Manager and Rotation Lifecycle Work?**
6. **How Does OIDC Replace Permanent CI Credentials?**
7. **How Do You Verify Access and Respond to a Leaked Secret?**
8. **How Do You Build an End-to-End Least-Privilege Delivery Path?**

## How Do Least Privilege and Secret Management Reduce the Same Risk?
<!-- section-summary: Both practices limit what an attacker gains after compromising an identity or credential. -->

Security design should assume that a laptop can be compromised, a token can leak, a dependency can act maliciously, a runner can be attacked, or a person can make a mistake. The goal is not to pretend every compromise can be prevented. It is to make each failure small, temporary, attributable, detectable, and revocable.

## How Do You Derive Access from One Exact Job?
<!-- section-summary: Least privilege narrows identity, actions, resources, conditions, environment, and time to the work that must be performed. -->

Start with the job rather than a product role. “CI needs cloud access” hides the decision. “The ParcelPulse release workflow must upload one new image and update one production service” exposes the necessary actions and excludes unrelated ones.

For that upload job, the required work might be:

- Authenticate to the container registry.
- Push an image to the ParcelPulse repository.
- Read existing tags when the release process needs them.

It does not require deleting repositories, changing identity policy, reading production data, creating users, or modifying network configuration.

Least privilege can be represented as a tuple:

```text
privilege = (
  identity,
  actions,
  resources,
  conditions,
  environment,
  lifetime
)
```

Every field should be as narrow as the actual job permits. A permanent administrator role over an entire account can deploy ParcelPulse, but success alone is not the objective. A stronger design allows the named production workflow to read its artifact and update the ParcelPulse service in production during a ten-minute session.

This narrowing controls blast radius. If a cloud administrator credential and a staging-only deploy credential are both stolen, the initial compromise is similar but the reachable systems differ dramatically. The administrator can change identities, databases, networks, secrets, and compute. The staging deployer can affect one service in one environment.

Least privilege applies to data as well as API operations. A support tool that needs names, delivery addresses, and status for active parcels does not need every customer column or historical record. The same question applies: what information does the job actually require?

Time is another resource. A human who needs production access for incident `INC-842` can receive a temporary operator session that expires after thirty minutes instead of remaining a production administrator indefinitely. Shorter lifetime reduces the opportunity for unnoticed abuse and removes access automatically after the task.

## Why Should Humans, Workloads, and Environments Have Separate Identities?
<!-- section-summary: Separate identities preserve attribution and keep compromise of one actor or environment from inheriting unrelated authority. -->

Permissions belong to identities. Delivery systems have human identities such as a developer, SRE, or security engineer, and workload identities such as a GitHub Actions workflow, Kubernetes Pod, Terraform pipeline, API service, backup task, or monitoring agent.

A machine should not normally operate with a person's credential. Copying a developer cloud key into CI makes the workflow indistinguishable from the developer in authorization and audit records. A named human account, a CI workload identity, and an application workload identity should be separate principals with separate jobs.

Human access tends to grow through privilege creep. A developer first receives staging-log access, later restart permission, then temporary production debugging, and eventually retains database, secrets, cluster, and identity privileges that nobody designed as one role. A healthier model keeps everyday access small and provides approved, expiring elevation for exceptional work.

Workload access can be narrower because a machine normally performs a repeatable task. Split ParcelPulse identities by responsibility:

```text
parcelpulse-api        -> application database operations
parcelpulse-worker     -> consume and publish queue messages
parcelpulse-monitoring -> read metrics
parcelpulse-backup     -> create database snapshots
parcelpulse-deployer   -> update the service
```

A shared production service account erases these boundaries. Compromising the monitoring agent could then provide database write or deployment access. Separate identities preserve both limitation and attribution.

Environments also need distinct trust boundaries. Development, staging, and production should have their own identities, secrets, data, and resource policies. One credential shared across all three lets the weakest environment become a path into the strongest. Environment separation makes the intended promotion boundary meaningful.

Repository protection belongs here because code controls workload identities. If merging to `main` launches a workflow that can assume a production role, an attacker can target the workflow definition or merge path instead of stealing the final credential. Protected branches, required review, controlled merge permission, review of deployment-workflow changes, protected environments, and approval gates defend whatever can cause privileged automation to act.

## What Makes a Static or Exposed Secret Dangerous?
<!-- section-summary: Bearer secrets are copyable authority, and static shared values increase exposure, lifetime, ambiguity, and rotation cost. -->

A secret is information whose possession grants capability or reveals protected data. Passwords, API keys, database credentials, private keys, OAuth client secrets, cloud access keys, signing keys, and encryption keys all fit this model.

Many are bearer secrets: the receiver trusts whoever presents the value. Anyone who copies it can impersonate its intended owner until the value expires or is revoked.

A static shared cloud key copied to a laptop, CI settings, Terraform environment, deployment script, and backup task has five exposure points and one ambiguous identity. Audit records name the shared user rather than the actual caller. Rotation becomes frightening because changing the key can break every consumer, so the team postpones it and the secret remains valid longer.

```text
shared credential -> many consumers -> difficult rotation
                  -> long lifetime -> more exposure
                  -> even more difficult replacement
```

The strongest secret is often one that never needs to be created. Before deciding where to store a permanent CI key, ask whether workload identity can issue temporary authorization instead.

Secrets must stay out of source. Replacing a committed password with an environment lookup does not remove the old value from Git history, clones, forks, pull-request snapshots, caches, logs, or developer machines. Once a value enters an uncontrolled location, assume it can be copied. Deletion is cleanup; revocation is containment.

Builds are another exposure boundary:

```dockerfile
ENV DB_PASSWORD=mysecret
COPY credentials.json /app/
```

Either instruction can place a credential in the image or its layers. Anyone able to inspect the artifact may recover it. Production secrets should enter at runtime so one immutable artifact can run with staging or production identity and configuration without embedding either environment's credentials.

Environment variables are only a delivery mechanism. They answer how a process receives a value, not where the value came from, who copied it, how it is authorized, when it rotates, or how it is revoked. A spreadsheet copied into a CI variable and then exposed as an environment variable still has a weak lifecycle.

Secret detection is different from protection. Scanners can catch patterns resembling tokens, keys, or credentials before or after a commit. They are a safety net behind a design that avoids committing secrets; they do not replace a secret manager or a leak-response process.

![Static key versus scoped sessions infographic comparing one long-lived CI secret with separate people, workload, and pipeline sessions](/content-assets/articles/article-devsecops-security-foundations-least-privilege/static-key-vs-scoped-sessions.png)

_The comparison shows how one copied key expands identity, scope, lifetime, and exposure._

## How Should a Secret Manager and Rotation Lifecycle Work?
<!-- section-summary: A secret manager centralizes storage behind identity policy, while safe rotation coordinates new credentials, consumers, verification, and revocation. -->

A secret manager stores sensitive values behind authenticated and authorized access. The application authenticates as `parcelpulse-api`, requests the ParcelPulse production database credential, and receives it only when policy permits that identity to read that specific secret.

Central storage does not remove the authorization question. Granting the API access to `secrets/*` exposes unrelated billing, payroll, and analytics credentials. The policy should select the narrow path for ParcelPulse, or issue a temporary database credential when the platform supports it.

A complete secret lifecycle covers creation, storage, distribution, authorization, use, rotation, audit, revocation, and destruction. Ignoring any stage leaves an unmanaged boundary.

Rotation is primarily a cutover problem. Suppose twenty API instances use credential A. Replacing it instantly with B makes every still-running instance fail authentication. When the backing system permits overlap, rotate in stages:

1. Keep A working.
2. Create B while A remains valid.
3. Update or redeploy every consumer to B.
4. Verify that new sessions and all instances use B.
5. Revoke A.

The overlap preserves availability while verification closes the old path. Rotation must coordinate credential creation, workload rollout, health evidence, and final revocation.

![Secret manager rotation loop infographic showing store, grant, read, rotate, restart, revoke old, and audit around a central vault](/content-assets/articles/article-devsecops-security-foundations-least-privilege/secret-rotation-loop.png)

_Rotation is a controlled consumer migration, not merely replacing one stored string._

Frequency is not the deepest objective. A manually rotated ninety-day password remains broadly useful throughout its lifetime. A credential generated automatically for fifteen minutes continuously expires and has a smaller theft window. Architecture should move, where possible, from long-lived static credentials to dynamic credentials and then to identity-based temporary authorization.

Rotation also needs an owner and observable completion criteria. Someone must know which systems issue the credential, which consumers hold it, how those consumers reload it, and what evidence proves the former value is no longer in use. Otherwise a team may declare rotation complete after updating the central store while an old process, scheduled job, or recovery script continues presenting credential A. Authentication logs can reveal that remaining dependency before A is revoked, and a post-revocation health check can confirm that the cutover did not silently disable a worker.

Different credential types require different cutover mechanics. An application password may support two simultaneous values. A certificate may require distributing a new trust chain before changing the serving certificate. An API token may need a new token created, consumers updated, and the old token disabled. The exact sequence changes, but the invariant does not: introduce the replacement safely, move known consumers, verify their behavior, and remove the old authority.

## How Does OIDC Replace Permanent CI Credentials?
<!-- section-summary: OIDC federation lets a CI job prove workload identity and receive a temporary, narrowly scoped role session. -->

Traditional CI authentication creates a permanent cloud key, stores it in the CI platform, and injects it into every deployment job. The powerful credential exists even when no deployment is happening.

OIDC federation changes the flow:

```text
workflow starts
  -> CI platform issues a signed identity token
  -> cloud validates issuer and workload claims
  -> cloud issues temporary credentials
  -> workflow performs the deployment
  -> credentials expire
```

Authentication moves from possession of a shared secret to proof of workload identity. The cloud can evaluate repository, branch, workflow, or deployment-environment claims before issuing access.

OIDC alone is not least privilege. A trust policy that accepts every workflow in an organization is still broad. A narrow trust relationship can require the ParcelPulse organization, repository, protected `main` branch, approved production workflow, and production environment. A feature branch, fork, or unrelated repository should fail the identity condition.

Those conditions apply the same capability-space-time model used for people and services. Capability limits the deployment actions in the resulting role. Space limits the repository, environment, service, and cloud resources to which those actions apply. Time is bounded by the temporary session lifetime. Identity claims then answer which exact workflow requested the session. A short lifetime is valuable, but it cannot compensate for an administrator-level permission set or a trust rule that admits every repository.

Two policies work together:

- The **trust policy** states which workflow may assume the role.
- The **permission policy** states what the assumed role may do.

The first can say that only the ParcelPulse production deployment workflow may become `prod-deployer`. The second can allow that role to update only the ParcelPulse production service and read the required artifact.


_Federation narrows both who may request production authority and how long the resulting session exists._

The OIDC token is evidence about the current workflow, not a permanent replacement secret copied into CI. The cloud trust policy evaluates claims such as repository, branch, workflow, audience, and environment before issuing a temporary role session. The role must still be narrow, because short lifetime limits exposure time but does not reduce what the session can do while valid.

Protect the controller of that privilege. An attacker who modifies the authorized workflow can execute commands while the legitimate workload holds its temporary role. Repository review, branch rules, environment approval, and pinned workflow dependencies are therefore part of credential protection.

## How Do You Verify Access and Respond to a Leaked Secret?
<!-- section-summary: Audit evidence reveals actual access, supports permission reduction, and guides a containment-first credential response. -->

Permissions drift after design. Humans accumulate roles, workloads change behavior, and temporary exceptions become permanent. Audit data must answer who retrieved a secret, which workflow assumed a role, which repository initiated a deployment, which resources changed, when a credential was last used, whether an old key remains active, and which denied actions were attempted.

Unused privilege is evidence for reduction. If `parcelpulse-api` can read and write storage and consume queues but ninety days of telemetry shows only database access and queue publishing, review and remove the unused storage and queue-consume permissions. Least privilege is a loop:

```text
grant narrowly -> observe -> identify unused access -> remove -> observe again
```

When a secret leaks, treat exposure as enough reason to act. The initial absence of confirmed abuse does not make the credential safe. Follow this order:

1. Revoke or disable the exposed value.
2. Issue a replacement only when a consumer still needs it.
3. Move consumers safely to the replacement.
4. Search authentication, API, CI, repository, and artifact records for use and propagation.
5. Remove the value from active branches, variables, images, documents, tickets, and history where appropriate.
6. Identify how the control failed and improve prevention or detection.

Containment comes before a long Git-history cleanup. A secret visible for thirty seconds can already be cloned, cached, mirrored, indexed, logged, or copied. Revocation gives a clear property: every copy of the old value becomes useless.

Credential design changes incident severity. A five-year production administrator key can provide access until a human detects and revokes it. A twenty-four-hour deploy token shortens the window. A fifteen-minute OIDC-derived role restricted to one deployment operation combines short lifetime with small capability and scope.

Access reviews should inspect both the written policy and observed behavior. The written policy shows what an identity could do; logs show what it actually did. Neither view is sufficient alone. A service may rarely exercise a disaster-recovery permission that remains necessary, while a supposedly narrow workflow may reveal unexpected access to unrelated resources. Reviewers should connect every retained privilege to a current job, owner, environment, and reason, then remove grants that have no defensible use.

Review denied actions as well as successful ones. Repeated denials may show an application attempting work outside its intended job, a stale configuration, or someone probing the boundary. A denial does not automatically justify granting more access. First decide whether the attempted action belongs to the identity's current responsibility. If it does, add only the missing capability in the smallest resource and time scope. If it does not, correct the workload or investigate the behavior. This prevents operational pressure from turning every authorization error into permanent privilege growth.

The review should end with a recorded owner and next review point for every exception that remains.

## How Do You Build an End-to-End Least-Privilege Delivery Path?
<!-- section-summary: A strong path gives each actor one identity, one job, a narrow resource boundary, temporary authority, and observable use. -->

ParcelPulse can now connect every boundary.

Developers use individual SSO identities and cannot modify production directly. Protected `main` requires review, and changes to privileged workflows receive additional scrutiny. Production elevation for people is approved, time-bounded, and tied to an operational reason.

CI stores no permanent cloud key. The approved repository and production environment obtain an OIDC token, exchange it for a short-lived deployment role, and update only the ParcelPulse service. Development and staging use different identities, secrets, resources, and trust conditions.

The production API runs under its own workload identity. It retrieves only the ParcelPulse database credential from the secret manager, publishes to the required queue, and receives application-level database permission rather than administrator access. Monitoring, workers, backup, and deployment each use different identities.

```text
human identity
  -> protected repository
  -> reviewed source and workflow
  -> CI workload identity
  -> OIDC federation
  -> short-lived deploy role
  -> ParcelPulse workload identity
  -> narrow runtime access
  -> secret manager, database, and queue
```

At each transition, ask who the actor is, which job is being performed, which operation and resource are necessary, which conditions must hold, and how long the authority should last.

The maturity direction is shared credentials, then individual credentials, scoped credentials, managed secrets, short-lived credentials, and finally federated workload identity where possible. A secret manager handles sensitive values that must exist. Least privilege constrains what the holder can do. Workload identity removes many permanent secrets entirely.

The enduring design principles are simple: identify every actor; assign one job; narrow capability, resource, and time; avoid permanent secrets when federation is available; manage the full lifecycle of secrets that remain; keep secrets out of distributable source and artifacts; protect systems that can invoke privilege; observe actual usage; revoke exposures quickly; and design as though a credential will eventually be compromised.

### How Do Capability, Space, and Time Guide Every Review?

For each privileged identity, inspect three practical dimensions. **Capability** is the set of operations such as read, write, delete, deploy, assume a role, or administer identity. **Space** is where those operations apply: every cloud resource or one ParcelPulse service, every secret or one database credential, every queue or one delivery-events topic. **Time** is the period during which the identity can act.

```text
least privilege
  = minimum necessary capability
  x minimum necessary space
  x minimum necessary time
```

Conditions refine those dimensions. A deployment role can require a protected environment, reviewed source, approved repository, expected workflow, and current incident or change context. A human production role can require MFA and an approval. A secret-reading workload can be limited to its runtime identity and environment.

These constraints should be tested negatively as well as positively. The intended workflow must succeed. A feature branch, fork, other repository, expired session, different service, and unrelated secret should fail. Denials prove the boundary instead of only proving that the allowed path works.

### Why Does Secret Design Change the Severity of Failure?

Compare three credential architectures. A production administrator key valid for five years and stored in CI provides broad access until somebody detects and revokes it. A deployment token valid for one day has a smaller time window but can still be copied. A fifteen-minute federated credential restricted to updating ParcelPulse combines limited time, capability, scope, and trust conditions.

An attacker may copy any of them. Architecture determines what the copied value can accomplish and how long it remains useful. This is why leak prevention alone is insufficient. A defensible system assumes exposure and makes the resulting authority narrow.

Revocability is a particularly valuable property. A secret removed from a repository may survive in clones and caches, but disabling the credential makes every copy unusable. Short-lived credentials add automatic revocation through expiration. Central issuance and logging let responders identify the session and owner rather than searching for every place a shared value might have been copied.

### How Does Privilege Maintenance Survive Change?

Access models decay as applications add features, teams change ownership, workflows move, and incidents create temporary exceptions. Record an owner and purpose for each privileged identity and remaining static secret. Review the consumers, resource scope, last use, lifetime, rotation path, and revocation procedure.

Access telemetry can show that a permission is unused, but absence of recorded use needs context. Some disaster-recovery permissions are intentionally rare. Remove access when the job no longer requires it; keep rare authority only when the recovery responsibility is current, tested, and controlled.

Human and machine offboarding are equally important. Remove a departing person from groups and elevation paths. Disable abandoned workload identities, old OIDC trust relationships, inactive keys, unused secret versions, and retired environment approvals. A forgotten machine identity can retain authority long after its repository or job disappears.

The maintenance loop ends where the article began: ask what exact job still exists, who currently owns it, what access it requires now, and how compromise would be contained. Least privilege is a continuing decision process rather than a one-time IAM document.

## Check Your Answers

:::expand[How Do Least Privilege and Secret Management Reduce the Same Risk?]{kind="recap"}
Both reduce compromise impact by shrinking privilege, resource scope, credential lifetime, and exposure.
:::

:::expand[How Do You Derive Access from One Exact Job?]{kind="recap"}
Name the identity, actions, resources, conditions, environment, and duration required for one defined task.
:::

:::expand[Why Should Humans, Workloads, and Environments Have Separate Identities?]{kind="recap"}
Separation preserves attribution and prevents one actor or weaker environment from inheriting unrelated authority.
:::

:::expand[What Makes a Static or Exposed Secret Dangerous?]{kind="recap"}
Bearer secrets can be copied, and shared long-lived values expand exposure, ambiguity, blast radius, and rotation cost.
:::

:::expand[How Should a Secret Manager and Rotation Lifecycle Work?]{kind="recap"}
Authorize access to individual secrets and rotate through creation, consumer migration, verification, and old-value revocation.
:::

:::expand[How Does OIDC Replace Permanent CI Credentials?]{kind="recap"}
The workflow proves a narrowly defined identity and receives an expiring role whose permissions cover only the deployment job.
:::

:::expand[How Do You Verify Access and Respond to a Leaked Secret?]{kind="recap"}
Use audit evidence to remove unused privilege, and contain leaks by revoking before rotating, investigating, and cleaning copies.
:::

:::expand[How Do You Build an End-to-End Least-Privilege Delivery Path?]{kind="recap"}
Give each human, workflow, workload, and environment a distinct identity, narrow job, temporary access, and observable lifecycle.
:::

## References

- [NIST glossary: least privilege](https://csrc.nist.gov/glossary/term/least_privilege) - Defines restricting users and processes to the minimum access required for authorized work.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Explains identity tokens and short-lived cloud authorization for workflows.
- [OWASP Secrets Management Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html) - Covers centralized secret storage, access, rotation, audit, and lifecycle practices.
- [Docker build secrets](https://docs.docker.com/build/building/secrets/) - Documents secret mounts that avoid persisting sensitive values in Dockerfile arguments or layers.
