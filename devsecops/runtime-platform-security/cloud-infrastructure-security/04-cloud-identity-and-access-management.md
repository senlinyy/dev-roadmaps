---
title: "Cloud Identity and Access Management"
description: "Learn how human federation, workload identity, CI OIDC, least-privilege roles, permission boundaries, explicit deny, temporary elevation, break-glass, and access reviews control cloud authority."
overview: "Start with the caller behind every cloud API action. Separate authentication from authorization, map capabilities and production roles, federate humans through groups, give workloads and CI contextual short-lived identities, constrain delegation and escalation paths, keep control-plane and data-plane authority distinct, test emergency access, and use identity-quality audit evidence to remove stale relationships."
tags: ["devsecops", "cloud-security", "iam", "least-privilege"]
order: 4
id: article-devsecops-cloud-infrastructure-security-cloud-identity-and-access
aliases:
  - iam-review
  - break-glass-access
  - article-devsecops-cloud-infrastructure-security-iam-review
  - article-devsecops-cloud-infrastructure-security-break-glass-access
  - devsecops/cloud-infrastructure-security/iam-review.md
  - devsecops/cloud-infrastructure-security/break-glass-access.md
  - devsecops/cloud-infrastructure-security/04-cloud-identity-and-access.md
  - devsecops/cloud-infrastructure-security/04-cloud-identity-and-access
  - cloud-infrastructure-security/04-cloud-identity-and-access
---

## Table of Contents

1. [Why Does Every Cloud Change Need a Clear Caller?](#why-does-every-cloud-change-need-a-clear-caller)
2. [How Do You Map Capabilities and Least Privilege?](#how-do-you-map-capabilities-and-least-privilege)
3. [How Should Human Federation, Groups, and Roles Work?](#how-should-human-federation-groups-and-roles-work)
4. [How Do Workload Identity and CI OIDC Remove Bootstrap Secrets?](#how-do-workload-identity-and-ci-oidc-remove-bootstrap-secrets)
5. [How Do Permission Boundaries and Explicit Deny Constrain Escalation?](#how-do-permission-boundaries-and-explicit-deny-constrain-escalation)
6. [Why Must Build, Deployment, Runtime, and Environment Identities Differ?](#why-must-build-deployment-runtime-and-environment-identities-differ)
7. [How Should Temporary Elevation and Break-Glass Access Work?](#how-should-temporary-elevation-and-break-glass-access-work)
8. [How Do Access Reviews and Audit Evidence Keep IAM Accurate?](#how-do-access-reviews-and-audit-evidence-keep-iam-accurate)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Every cloud action has a caller. A human opens a console, a CI job applies infrastructure, a deployment workflow updates a service, an application reads storage, or a managed service calls another API. Cloud IAM determines how that caller proves identity and which actions the provider permits.

**Authentication** answers “Who or what is this caller?” Passwords, federated sessions, workload tokens, certificates, access keys, and signed requests can establish identity.

**Authorization** answers “What may this authenticated identity do?” Policies evaluate action, resource, environment, conditions, and explicit constraints.

```text
identity proof -> authentication
policy decision -> authorization
```

A successful authentication does not imply permission. A denied API call from a valid identity can be valuable evidence that the boundary works.

IAM is fundamentally about capabilities. Rather than asking whether Alice, CI, or `payments-api` “has cloud access,” ask whether the identity can read object X, decrypt key Y, update service Z, create roles, change logging, or assume another identity.

Keep these questions in view as you work through the lesson:

1. **Why Does Every Cloud Change Need a Clear Caller?**
2. **How Do You Map Capabilities and Least Privilege?**
3. **How Should Human Federation, Groups, and Roles Work?**
4. **How Do Workload Identity and CI OIDC Remove Bootstrap Secrets?**
5. **How Do Permission Boundaries and Explicit Deny Constrain Escalation?**
6. **Why Must Build, Deployment, Runtime, and Environment Identities Differ?**
7. **How Should Temporary Elevation and Break-Glass Access Work?**
8. **How Do Access Reviews and Audit Evidence Keep IAM Accurate?**

## Why Does Every Cloud Change Need a Clear Caller?
<!-- section-summary: Every cloud data or control-plane operation is performed by a human or workload identity whose authentication context and authorized capabilities should be explicit. -->

A useful capability model includes:

- **Action:** read, write, deploy, delete, decrypt, impersonate, administer.
- **Resource:** exact service, bucket, key, role, project, account, or namespace.
- **Conditions:** environment, source network, workload claims, tags, time, approval.
- **Duration:** standing grant or temporary session.
- **Delegation:** roles or service identities the caller can become.

The goal is not “nobody has access.” Production must operate, deploy, recover, and be investigated. The goal is that every necessary path has a purpose, bounded capability, responsible owner, strong identity, time model, and evidence.

Build a production access map before writing policies. Include deployment, runtime, plan, read-only incident, security audit, backup, managed-service, and emergency recovery identities. A list of users misses workload and delegation paths.

For each relationship, record the identity provider or platform, role, permitted actions, resource scope, conditions, session duration, owner, approval, and logs. This map exposes overlaps such as a CI role that can both deploy an application and edit the role it assumes.

Every cloud change includes a control-plane caller even when it originates from declarative code. Terraform, a managed deployment service, and a Kubernetes controller eventually authenticate to provider APIs. “Automation changed it” is not enough; the automation should use a distinct identity that can be traced to a repository, workflow, run, and approved input.

Data-plane calls also deserve identity. An application reading storage as a shared node role weakens attribution and gives sibling workloads the same capability. A service-specific identity makes both permission and audit records align with the actual workload.

Identity boundaries support incident containment. If one application identity is compromised, responders can enumerate its allowed actions, revoke or block the role, and distinguish its events. A shared account forces investigation across every service that used the credential.

![Production access map separates plan, deploy, runtime, incident-read, security-audit, and emergency roles with evidence trails](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/production-access-map.png)

_IAM review begins with relationships between callers and capabilities, not a flat list of account members._

## How Do You Map Capabilities and Least Privilege?
<!-- section-summary: Least privilege grants one identity only the capabilities, resource scope, conditions, and time needed for its current job, then verifies actual use and expected denials. -->

Least privilege limits blast radius. An overprivileged CI identity that can administer every resource turns workflow compromise into account compromise. A deployment identity restricted to updating one service limits what the same attacker can change.

Start from the job:

```text
identity: parcelpulse-production-deployer
action: update service deployment
resource: parcelpulse production service only
conditions: approved workflow and production environment
duration: short role session
```

Avoid designing from a convenient administrator policy and subtracting a few actions. List the exact API operations used by a normal run, grant them narrowly, and investigate denials rather than automatically broadening permission.

Resource scope matters. `storage:*` on every bucket is broader than reading one configuration object. Action scope matters. Updating a service does not require creating IAM roles. Time matters. A permanent grant exists during every compromise window; a short session exists only when the job runs.

Least privilege is a loop:

```text
grant narrowly -> observe use -> remove unused capability -> test -> repeat
```

Audit successful and denied operations. An unused permission may be removable, though rare recovery duties need confirmation. Repeated denied attempts may indicate missing legitimate capability, a stale script, or suspicious probing. A denial is not automatic evidence to grant more.

Test negative permissions. The plan identity should fail to apply. The staging role should fail against production. The runtime service should fail to change its own IAM policy. A deployment role should fail to create a broader role. These tests prove effective boundaries more directly than policy text.

Account and project hierarchy can add outer constraints. Organization policy, service-control-style policy, and permission boundaries can set a maximum even when a local administrator attaches a broader allow. Keep the intended layers understandable and test the combined effective result.

Least privilege also applies to read actions. Read-only access can expose customer data, secrets, infrastructure topology, logs, source artifacts, or encryption material. Do not treat `ReadOnly` as universally low risk; scope it to the data and operational question.

Conditions can narrow otherwise broad actions. Require expected resource tags, source identity, network, service, region, or session properties where the provider supports reliable conditions. Do not base critical authorization on a user-controlled tag or name without protecting who can change it.

Policy simulators and access analyzers help, but test important calls using dedicated fixtures or lower environments. A simulated deny can differ from reality because of resource policy, organization policy, session policy, or service-specific behavior. Effective access is the combined decision of all relevant layers.

Avoid wildcard resources merely because an API does not reveal the exact resource until runtime. Investigate whether the operation can be redesigned, isolated into another role, constrained by condition, or protected by a maximum boundary. Document genuine provider limitations rather than normalizing them silently.

## How Should Human Federation, Groups, and Roles Work?
<!-- section-summary: Human access should begin with a central identity provider, map people through durable groups into cloud roles, use short sessions, and avoid permanent individual cloud credentials. -->

Human federation lets a person authenticate through the organization's identity provider and receive a cloud session. The identity provider owns joiner, mover, leaver lifecycle, multifactor authentication, device or risk policy, and central account disablement.

```text
employee -> identity provider -> group membership -> cloud role -> temporary session
```

Federation removes the need for separate long-lived cloud passwords and access keys for each person. Disabling the central account can cut off new sessions across providers, subject to session lifetime and revocation behavior.

Groups and roles are better than individual permission attachments. `ProductionReadOnly`, `PlatformDeployers`, or `SecurityAudit` express a job relationship that can be reviewed and reassigned. Do not accumulate one-off grants that survive team changes and become impossible to explain.

Group membership is authority. Protect who can add members, require appropriate approval, log changes, and review nested or dynamic groups. A well-written cloud role is not least privilege if a broad group can assume it.

Use short sessions and reauthentication for sensitive roles. A person may hold ordinary read access but request temporary elevated capability for a deployment or incident. The session should state actor, role, reason, time, and approval where required.

Avoid shared human accounts. Audit logs that say `prod-admin` cannot distinguish Alice, Bob, an automation process, or an attacker using their shared credential. Individual federated identity improves authorization, attribution, and revocation.

Do not attach critical production policy directly to a named person as the long-term model. Durable teams and roles preserve continuity; audit events still identify the actual person who assumed the role.

Federation configuration is part of the trust chain. Protect identity-provider administrators, application registrations, group mapping, claims, and cloud trust settings. An attacker who can add themselves to the production group does not need to defeat the cloud role policy.

Joiner, mover, and leaver automation should remove old relationships promptly. Moving from platform engineering to another team should not leave production deployment membership. Offboarding should revoke active credentials and sessions according to provider capability, not only prevent the next login.

Privileged roles can require stronger session controls than ordinary roles: phishing-resistant multifactor authentication, managed devices, shorter duration, reauthentication, and approval. Record the actual federated subject even when the cloud event shows an assumed-role session name.

Review nested groups and group ownership. A production group may be small directly but include a broad engineering group through nesting. Dynamic rules based on department or attributes can grant access unexpectedly when source data changes.

## How Do Workload Identity and CI OIDC Remove Bootstrap Secrets?
<!-- section-summary: Workload identity lets a platform attest which workload or workflow is running so it can receive temporary cloud authorization without storing a permanent bootstrap credential. -->

Humans and workloads are different identity problems. An application cannot complete interactive SSO each time it starts. Traditionally, teams place a cloud key or service-account credential on the machine so the workload can authenticate.

That creates a bootstrap secret: the workload must already possess authority to prove who it is. The credential can be copied from disk, an image, environment, secret store, or runner and reused elsewhere until revoked.

**Workload identity** uses facts the platform can attest: service account, cluster, namespace, cloud resource, instance, repository, workflow, or environment. The workload exchanges signed platform identity for a short cloud session.

```text
platform knows workload context
      -> signed identity assertion
      -> cloud validates trust conditions
      -> temporary scoped role
```

Identity should follow the workload, not the machine. Two applications on one node need different roles. Moving an application to a new node should not require copying a permanent key. The orchestrator or cloud platform can issue identity for the service itself.

CI/CD has the same problem. Storing one permanent cloud deploy key in the CI platform creates standing authority. OIDC federation lets a job request a token containing repository, ref, workflow, environment, issuer, and audience claims.

The cloud trust policy answers which token context may assume the role. The permission policy answers what the role may do.

```text
trust policy: approved repository + protected workflow + production environment
permission policy: update ParcelPulse production service only
```

![OIDC trust chain validates repository, environment, audience, and source claims before issuing temporary cloud credentials](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/oidc-trust-chain.png)

_Federation removes the stored cloud key, but the trust and permission policies still define the security boundary._

Broad OIDC trust is dangerous. Accepting any repository, branch, or workflow in an organization lets a lower-trust workload become the role. Validate issuer and audience, match precise claims, protect the workflow and environment that generate them, and audit sessions.

Workload identity is better than shared secrets because it improves scope, attribution, lifetime, and revocation. It does not protect a legitimate identity while malicious code runs inside the authorized workload. Runtime and pipeline security still matter.

Workload identity needs admission control. Decide which orchestrator service account, cloud resource, cluster, namespace, repository, or workflow may map to the cloud identity. If any workload can choose the trusted service-account name, the identity boundary is only a label.

Audience validation prevents a token intended for one relying service from being accepted elsewhere. Issuer validation ensures the assertion came from the expected platform. Subject and contextual claims narrow the workload. Expiry limits time. All four belong in the exchange.

Do not let one machine-level role remain as an unmonitored fallback after workload identity is introduced. Node or instance credentials may still be reachable through metadata. Minimize the underlying role, block workload access where possible, and verify applications use the intended federated path.

For CI, separate token issuance permission from cloud role permission. A job may need `id-token: write` to request an OIDC assertion, but the cloud trust policy decides whether that assertion can become a role. Restrict the permission to the deployment job and keep proposed pull-request code away from the production context.

Audit role sessions using meaningful workload attributes and correlate them with platform run IDs. Alert when a repository, branch, workflow, environment, cluster, namespace, or time falls outside the normal pattern even if authentication succeeds.

## How Do Permission Boundaries and Explicit Deny Constrain Escalation?
<!-- section-summary: Maximum-permission boundaries and explicit denies limit the effective authority local policies can grant, while escalation analysis follows every path by which an identity can create, modify, pass, or assume more powerful roles. -->

A permission boundary or equivalent maximum policy says that even if another administrator attaches a broader allow, effective permission cannot exceed the boundary. Organization-level constraints can provide another ceiling across accounts or projects.

Explicit deny is powerful because it overrides ordinary allows in many IAM models. It can forbid disabling audit, leaving approved regions, making protected data public, or changing specific security roles even when a local policy is broad.

Use outer controls for invariants, not as a substitute for readable least-privilege roles. A role with thousands of unnecessary allows below one deny remains difficult to review and may exploit actions the deny forgot.

Privilege escalation is about paths. An identity lacking `Administrator` may still become administrator if it can:

- Create or update a role and then assume it.
- Pass a powerful role to a service it controls.
- Modify a function or instance that already has a strong identity.
- Change a trust policy or group membership.
- Read another identity's credentials.
- Disable the boundary or organization policy.

Model delegation edges:

```text
caller -> can modify service -> service has role -> role can administer
```

Least-privilege review must include indirect authority. A deployment role may legitimately pass one runtime role to one service but should not pass arbitrary roles. A workload may create jobs but should not choose a stronger service identity.

Protect IAM policy changes with code review, plan analysis, policy as code, and additional ownership. Identity changes alter who can control every other security mechanism.

Separate who can write permissions, who can attach them, who can assume roles, and who can change outer boundaries where the risk justifies independent control.

Resource policies can create access even when the identity's central policy appears narrow. Storage buckets, keys, queues, secrets, and roles may trust external accounts or service principals. Access review should evaluate identity and resource policies together.

Explicit deny can protect audit trails and IAM infrastructure from deployment roles. For example, the application deployer may update service versions but can never disable logging, edit the production role, or leave approved regions. Test that local administrators cannot override the invariant.

Beware escalating through data. An identity able to alter a deployment template, startup script, container image, or function source can cause a more privileged service to execute its code. It may not need direct `AssumeRole`. Protect every code-to-role edge.

Permission boundaries also require governance. If the role creator can choose or remove its own boundary, the maximum is not effective. Enforce required boundaries and protect the organization-level mechanism that mandates them.

## Why Must Build, Deployment, Runtime, and Environment Identities Differ?
<!-- section-summary: Each delivery and runtime stage performs a different job, so separating identities prevents code execution or compromise in one stage from inheriting authority for another. -->

Build identity reads source and dependencies and writes an artifact. Deployment identity updates one environment. Runtime identity calls application dependencies. They do not need the same capabilities.

If the build can deploy production, a malicious compiler or package script can use that authority. If runtime can edit its own role, application compromise can become control-plane administration. Separate the paths.

```text
build role -> source read and artifact write
deploy role -> one service update
runtime role -> application data-plane calls
```

Environment separation matters too. Development, staging, and production should use different identities and resources. One shared role with conditional scripts increases lateral movement and makes audit less clear.

The production role trust policy can require protected workflow and environment approval. Staging cannot satisfy that context. Production permissions can name only production resources, while the development role cannot cross the resource boundary.

Separate control plane from data plane. The data plane handles application operations such as reading a message or object. The control plane creates resources, changes networking, modifies IAM, or deploys versions. An application normally needs data-plane capability, not control-plane administration.

Managed services also need explicit identities. Backups, monitoring, event delivery, and replication may assume service roles or use resource policies. Review the trusted service principal, conditions, resource scope, and ability to delegate.

Secrets often indicate weak identity architecture. If CI stores a cloud administrator key or a workload image contains a service-account file, ask whether platform identity or federation can remove the standing secret. Some application credentials remain necessary, but identity should replace credentials used merely to discover or assume another identity.

Runtime identities should follow service replicas. Every instance of the same service can receive the same bounded role without embedding a copied key, while different services remain separated on the same cluster or host. Session issuance and audit can still distinguish individual workload instances where the platform provides that context.

The plan role and apply role can differ. Pull requests may need read-only state and provider visibility to produce a plan. The protected apply path receives write authority only after review and policy. Be careful because read-only planning can still expose sensitive infrastructure and state.

Signing and publishing identities may need their own boundaries too. A build can create bytes without authorizing them for release. A signer can authenticate one digest without deploying it. A publisher can write one registry namespace. Separation limits a single compromised stage.

Environment separation should include state backends, secrets, keys, artifact repositories, and network, not only role names. A staging role with permission to read a shared production state or secret store still crosses the intended boundary.

## How Should Temporary Elevation and Break-Glass Access Work?
<!-- section-summary: Standing human administration should be replaced where possible by approved time-bounded elevation, with a separately protected and tested break-glass path for genuine recovery. -->

Standing access exists continuously. Needed access exists only while a job or incident requires it. Reducing standing production administration shrinks the interval in which a compromised account can act silently.

Temporary elevation can require a named request, reason or ticket, approval, strong reauthentication, bounded role, short duration, and automatic expiry. Audit events connect the person, elevation, actions, and end time.

**Break-glass** is emergency authority for recovery when ordinary identity, deployment, or approval systems cannot operate. Pretending it does not exist often produces an informal shared root credential.

A designed break-glass path should use protected credentials or identity, require named use where possible, notify responders immediately, limit time and actions, preserve all events, and force post-incident review and credential reset.

Emergency access must be tested. During a real identity-provider outage is not the first time to discover the account is disabled, the key expired, the role lacks recovery permission, or logs do not capture use. Test in a controlled exercise, rotate secrets, and verify alerting.

Break-glass should not be ordinary convenience. Frequent use means the normal access or recovery workflow is inadequate. Fix the recurring operational need rather than normalizing uncontrolled administration.

After use, reconcile every production change into IaC, policy, or the authoritative source, remove temporary grants, verify live state, and preserve the incident chain.

Temporary elevation should use the smallest role that solves the task. A database diagnostic does not require organization administrator. Define common incident roles for read-only investigation, service restart, network containment, and identity recovery rather than defaulting every request to root.

Approval does not eliminate the need for technical boundaries. The elevated role should still restrict resources and destructive actions. Human reviewers can misunderstand a request or an approved account can be compromised.

Alert on elevation creation, use, extension, and expiry. A session that remains active beyond its approved window or assumes a different role should trigger investigation. Capture commands or API actions through cloud audit and session tooling where appropriate.

Break-glass credentials require separate storage and access from normal SSO so an identity-provider outage does not block recovery. They also need strong protection, periodic rotation, dual control or other governance where consequence warrants it, and a tested way to retrieve them.

Exercises should verify not only login but the complete recovery objective and audit trail. Confirm the emergency role can perform the intended bounded action, cannot perform prohibited actions, generates alerts, and can be revoked and reconciled.

## How Do Access Reviews and Audit Evidence Keep IAM Accurate?
<!-- section-summary: Periodic reviews validate live relationships and actual use, while high-quality audit logs connect identities, sessions, API actions, resources, and outcomes for verification and response. -->

Permissions drift. People change teams, services stop using APIs, projects retire, temporary exceptions persist, and trust relationships broaden. Access reviews ask whether each relationship should still exist.

Review as a graph:

```text
identity -> group -> role -> action -> resource
identity -> can modify workload -> workload role -> resource
CI workflow -> OIDC trust -> deployment role -> environment
```

Inspect direct and indirect paths, group owners, trust policies, service accounts, machine identities, dormant keys, unused grants, cross-account roles, environment conditions, and outer boundaries.

Telemetry can identify unused permissions, but absence of observed use may reflect rare emergency duties. Ask the owner, validate the job, then remove or move the capability behind temporary elevation.

Audit logs need identity quality. A useful record names the human or workload, federated session and source claims, assumed role, API action, resource, time, source, request context, and outcome. Shared credentials and generic service users reduce accountability.

Connect cloud events to delivery evidence. A production update should show the approved CI workflow's role session and artifact or IaC run. A direct human change should show temporary elevation or break-glass reason. Unexpected identities become a detection signal.

Protect and centralize audit logs. Restrict deletion and configuration changes, monitor gaps, retain them for investigation, and avoid sending sensitive request values into broadly readable systems.

Review access as relationships rather than policy files. A role can be unused directly but reachable through another role. A service account can appear inactive while a scheduled job assumes it monthly. Query grants, trust, group membership, role passing, workload mapping, and resource policies as one graph.

Access-review evidence should record reviewer, scope, snapshot time, decisions, removed and retained relationships, justification, and follow-up. A spreadsheet saying “review complete” does not prove which live policies were examined.

Use provider last-access information and audit queries as evidence, not unquestionable truth. Some actions may be missing from summaries, logs may have retention gaps, and rare disaster-recovery permissions may not appear. Combine telemetry with owner attestation and negative testing.

Stale identities should be disabled and then removed through a controlled process. Preserve enough history to investigate their past actions. Rotate credentials and remove trust references so deletion does not leave another role still able to impersonate the retired principal.

IAM is part of every other security control. Encryption depends on who can use keys. Logging depends on who can disable it. Network policy depends on who can edit routes. Secrets depend on who can retrieve them. Supply-chain admission depends on who can change trust policy. Review IAM changes with consequence equal to the systems they govern.

![Cloud IAM summary connects human federation, workload identity, CI OIDC, least-privilege deployment, break-glass, and access review evidence](/content-assets/articles/article-devsecops-cloud-infrastructure-security-cloud-identity-and-access/cloud-iam-summary.png)

_Identity lifecycle and evidence turn IAM from a static policy file into a maintained security system._

The final mental model is:

```text
every cloud action has a caller
  -> caller proves identity
  -> policies and boundaries calculate capability
  -> temporary context limits duration and environment
  -> logs prove the action
  -> reviews remove relationships that no longer belong
```

## Check Your Answers

:::expand[Why Does Every Cloud Change Need a Clear Caller?]{kind="recap"}
Model each human and workload through authentication, capability, resource, conditions, duration, delegation, ownership, and evidence.
:::

:::expand[How Do You Map Capabilities and Least Privilege?]{kind="recap"}
Grant the smallest action, resource, condition, and session for the job, then observe use and test expected denials.
:::

:::expand[How Should Human Federation, Groups, and Roles Work?]{kind="recap"}
Use central identity, multifactor authentication, durable groups, role sessions, and individual attribution instead of permanent personal cloud credentials.
:::

:::expand[How Do Workload Identity and CI OIDC Remove Bootstrap Secrets?]{kind="recap"}
Let platforms attest workload context and exchange it for temporary scoped roles under precise trust and permission policies.
:::

:::expand[How Do Permission Boundaries and Explicit Deny Constrain Escalation?]{kind="recap"}
Set maximum authority and deny invariants, then analyze indirect paths through role creation, passing, impersonation, policy changes, and workload control.
:::

:::expand[Why Must Build, Deployment, Runtime, and Environment Identities Differ?]{kind="recap"}
Separate stage, environment, and control-plane authority so compromise in build, staging, or application runtime cannot inherit production administration.
:::

:::expand[How Should Temporary Elevation and Break-Glass Access Work?]{kind="recap"}
Replace standing administration with approved expiring sessions and keep emergency recovery narrow, tested, alerted, audited, and reconciled.
:::

:::expand[How Do Access Reviews and Audit Evidence Keep IAM Accurate?]{kind="recap"}
Review live identity relationships and actual use, preserve high-quality session and action evidence, and remove stale grants and trust paths.
:::

## References

- [AWS IAM best practices](https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html) - Covers federation, temporary credentials, least privilege, and access analysis.
- [Google Cloud IAM overview](https://cloud.google.com/iam/docs/overview) - Defines principals, roles, policies, and resource hierarchy.
- [Azure identity fundamentals](https://learn.microsoft.com/en-us/entra/fundamentals/identity-fundamental-concepts) - Describes human and workload identity concepts.
- [GitHub OIDC cloud federation](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - Documents workflow identity claims and cloud trust.
- [NIST SP 800-207 Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final) - Describes explicit identity and resource access principles.
