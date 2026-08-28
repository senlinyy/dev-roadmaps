---
title: "Infrastructure as Code Security"
description: "Learn how semantic plan review, IaC scanning, policy, protected state, provider and module controls, temporary cloud identity, controlled apply, and recovery secure infrastructure transitions."
overview: "Treat infrastructure configuration as code with unusual real-world privilege. Separate declarative intent from the plan that predicts a transition, inspect dangerous states and destructive actions, scan source and plan, protect secrets and state, review providers and modules as dependencies, separate plan from apply authority, enforce environment-aware policy, and preserve an evidence chain from pull request to live cloud and recovery."
tags: ["devsecops", "iac", "terraform", "cloud-security"]
order: 1
id: article-devsecops-cloud-infrastructure-security-iac-security-scanning
---

## Table of Contents

1. [Why Is Infrastructure Configuration Unusually Powerful Code?](#why-is-infrastructure-configuration-unusually-powerful-code)
2. [How Do Source Scans and Plans Reveal Different Risk?](#how-do-source-scans-and-plans-reveal-different-risk)
3. [How Should Secrets, State, and Environments Be Protected?](#how-should-secrets-state-and-environments-be-protected)
4. [Why Are Modules and Providers Supply-Chain Dependencies?](#why-are-modules-and-providers-supply-chain-dependencies)
5. [How Does Policy Evaluate Dangerous States and Transitions?](#how-does-policy-evaluate-dangerous-states-and-transitions)
6. [How Should Plan and Apply Identities Be Separated?](#how-should-plan-and-apply-identities-be-separated)
7. [How Do State, Apply Evidence, Break-Glass, and Recovery Fit Together?](#how-do-state-apply-evidence-break-glass-and-recovery-fit-together)
8. [What Does a Secure IaC Delivery Path Look Like?](#what-does-a-secure-iac-delivery-path-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

Infrastructure configuration is code with unusual privilege. A few lines can create public networks, databases, encryption keys, IAM roles, logging, backups, and destructive lifecycle behavior.

```hcl
resource "example_database" "orders" {
  public_access = true
}
```

The text is small. The real-world effect can be a stateful production service reachable from the Internet.

Infrastructure as Code improves security because desired state becomes reviewable, versioned, repeatable, scannable, and attributable. Pull requests can show who proposed a network path or identity grant. Modules can encode safer defaults. CI can produce plan and policy evidence before a cloud API changes reality.

Storing configuration in Git does not make it safe automatically. Unsafe declarations can receive approval. An attacker can modify a workflow or provider. State can leak secrets. A privileged runner can apply unreviewed code. Administrators can change live resources outside IaC.

IaC is commonly **declarative**. It describes the state that should exist rather than a fixed sequence of API commands. The tool compares configuration, recorded state, and provider reality, then constructs actions needed to converge.

Keep these questions in view as you work through the lesson:

1. **Why Is Infrastructure Configuration Unusually Powerful Code?**
2. **How Do Source Scans and Plans Reveal Different Risk?**
3. **How Should Secrets, State, and Environments Be Protected?**
4. **Why Are Modules and Providers Supply-Chain Dependencies?**
5. **How Does Policy Evaluate Dangerous States and Transitions?**
6. **How Should Plan and Apply Identities Be Separated?**
7. **How Do State, Apply Evidence, Break-Glass, and Recovery Fit Together?**
8. **What Does a Secure IaC Delivery Path Look Like?**

## Why Is Infrastructure Configuration Unusually Powerful Code?
<!-- section-summary: IaC is declarative code whose small reviewed changes can create large cloud states and authority transitions, so security must evaluate both the requested state and how production will reach it. -->

The **plan** is the semantic diff:

```text
desired configuration
       +
recorded and refreshed state
       +
provider behavior
       -> create, update, replace, delete, or no-op actions
```

Review the plan before apply because the production change is not merely the HCL lines. A harmless-looking attribute can force replacement. A module upgrade can change dozens of resources. A renamed address can appear as delete and create. A computed value can become public only after resolution.

IaC security is therefore about dangerous states and dangerous transitions. A public database is a dangerous state. Deleting and recreating a protected database to reach a new state is a dangerous transition even if the final configuration is safe.

The five core questions are:

1. What state are we asking production to have?
2. What will the system actually do to reach it?
3. Is that resulting state and transition allowed?
4. Who is authorized to make the change real?
5. Can we prove what happened and recover safely?

Declarative code changes review focus. In an imperative script, reviewers can follow commands in order. In IaC, the same declaration can lead to different actions depending on state and provider behavior. The plan translates intention into the proposed transition and must be treated as first-class review evidence.

One configuration change can fan out through a module. Changing a module version or input may affect many resources that are not visible in the root file. Review should follow module expansion and the plan summary rather than assume diff size predicts impact.

IaC also creates a powerful positive property: unsafe infrastructure patterns can be corrected once in a shared module and inherited by many consumers. Secure defaults for encryption, private networking, logging, tags, backups, and deletion protection reduce the number of individual decisions teams must get right.

Defaults must remain visible enough for review. A module that hides all network and identity behavior behind one convenient input can make consumers unable to explain effective state. Document the security contract, expose intentional safe extension points, and test the plan produced by common and boundary inputs.

The production change includes what the provider will do and what the cloud service will do after the API call. Creating a managed database may also create service identities, network interfaces, keys, or logs. Include these induced relationships in architecture and policy where they affect trust.

Security review should focus on state transitions that change reachability, authority, sensitive data, durability, or evidence. A formatting change and a trust-policy wildcard are both code diffs; their semantic consequences are radically different.

## How Do Source Scans and Plans Reveal Different Risk?
<!-- section-summary: Static scanners inspect declared patterns early, while plan analysis evaluates resolved resources and transition actions; both remain bounded models that need architecture context and live-state verification. -->

Static IaC scanning parses configuration without applying it. It can find public ingress, unencrypted storage, missing logging, weak identity grants, public buckets, hardcoded secrets, permissive Kubernetes settings, and absent lifecycle protection.

Typical findings include:

- `0.0.0.0/0` or `::/0` on administrative or data ports.
- Wildcard IAM actions or resources.
- Public access on storage or databases.
- Encryption, audit, versioning, or backup disabled.
- Secrets embedded in variables or resource arguments.
- Overly broad trust policies.
- Deletion protection absent on critical state.

Scanners do not automatically know architecture. Public ingress is expected for an Internet load balancer and unsafe for a private database. A wildcard may be required by a provider API but still need an outer permission boundary. Environment, data classification, owner, and compensating controls matter.

A useful finding explains consequence and object: “database.orders would accept connections from the Internet on its data port” is more actionable than a rule number.

Plan analysis catches issues source scanning can miss. It can see module expansion, resolved references, current-state interaction, replacement, deletion, effective identity policy, and provider-computed differences. It can identify that a change destroys a key, recreates a database, or widens a security group after expressions resolve.

![IaC review funnel moves configuration through plan JSON, scanners, secret checks, provider controls, policy, and controlled apply](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/iac-review-funnel.png)

_Source scanning provides early pattern feedback; the plan exposes the semantic transition; controlled apply makes the approved transition real._

A plan is not a perfect guarantee. It depends on state, refresh, credentials, provider version, external data, and the time between plan and apply. Live state can change after planning. Some values remain unknown until apply. Provider behavior can differ or fail partially.

Bind approval to the plan or exact source and regenerate when inputs change. A plan from commit A should not authorize commit B. A stale plan after live drift needs reevaluation.

Scan near the change so developers can repair it. Also scan after merge and continuously because new rules, provider knowledge, and drift can reveal existing unsafe infrastructure. Separate new-change gates from historical remediation so old debt does not freeze all delivery.

![Risky and safer Terraform states compare public storage, open database ingress, and broad IAM with private access and scoped capability](/content-assets/articles/article-devsecops-cloud-infrastructure-security-iac-security-scanning/risky-vs-safer-terraform.png)

_Security review should translate syntax into reachability, authority, data, and destructive-state consequence._

Scanner coverage should be explicit. A tool may understand common provider resources but not a custom module, new service, embedded policy document, or external data source. Record skipped files, unsupported constructs, and parse errors. “No findings” after incomplete analysis is not a clean result.

Custom modules may need organization-specific rules. A scanner sees a string input while the module knows that input becomes database ingress. Add custom checks or expose plan data so security decisions operate on the resulting resource instead of relying on the wrapper syntax.

Findings in the pull request should attach to the changed line or affected planned resource where possible. Include rule intent, consequence, environment, and remediation. A developer can correct a public rule quickly when the message explains the path it creates.

Plan JSON enables richer checks but needs schema and provider awareness. Values may be known, unknown, null, sensitive, or represented differently before apply. A policy that treats unknown as safe can admit a dangerous result. For critical properties, require known safe values or defer the transition until a later enforcement point can evaluate them.

Destroy and replacement review should identify dependencies and data. Replacing a security group may briefly change reachability. Replacing a key can make data unreadable. Replacing a database may create an empty service without restoring content. Plan action symbols alone do not express business impact.

Review both the planned end state and transition ordering. Temporary resources, create-before-destroy, dependency edges, and provider eventual consistency can create windows where old and new access coexist. Higher-risk migrations need explicit rollout and rollback design.

Existing unsafe infrastructure still matters even when new-change policy uses a baseline. Run scheduled scans and state queries, assign owners, and reduce debt. A ratchet prevents new violations; it does not make historical public exposure acceptable.

## How Should Secrets, State, and Environments Be Protected?
<!-- section-summary: IaC files, plan output, state, backends, variables, logs, and backups can contain sensitive values and architecture, while environment separation prevents lower-trust identities from reaching production data and authority. -->

Secrets do not belong casually in IaC files. A password committed to Git persists in history, clones, reviews, and caches. Reference a secret manager or inject values through a controlled apply boundary instead of placing the value in source.

Marking a Terraform value `sensitive` commonly redacts some CLI display. It does not guarantee the value is absent from state, plan files, provider requests, logs, or downstream resources. “Sensitive” often means “hide from ordinary output,” not “never stored.”

State is security-sensitive. It maps configuration to cloud resources and can contain resource attributes, endpoints, identifiers, generated passwords, connection values, policy documents, and outputs. Even when secrets are absent, state reveals infrastructure architecture useful to an attacker.

Protect the state backend with encryption, narrow identity, network controls, access logs, versioning, locking, retention, and recovery. Separate read and write access where practical. A pull-request plan may need constrained state visibility without permission to overwrite production state.

Locking prevents concurrent applies from corrupting or racing state. It is an availability and integrity control, not merely convenience. Monitor forced unlock and backend configuration changes.

Back up state because loss can make future plans destructive or force risky import. Secure backups with the same care as live state: encryption, access control, retention, immutability where appropriate, and restore tests.

Plan files and CI logs can contain sensitive values. Restrict artifacts, redact developer-facing output, set retention, and avoid posting full production plans into widely readable pull-request comments. Preserve a protected complete record for authorized review and investigation.

Separate production from lower environments through accounts or projects, roles, state backends, secrets, keys, networks, and approval. One shared state file or omnipotent apply role weakens the boundary even if resource names include `dev` and `prod`.

Production policy should understand environment. A disposable development resource may allow faster replacement. A production database needs stricter deletion, backup, encryption, network, and identity controls.

Secret values can enter state through generated resources, provider read-back, data sources, outputs, and module wiring even when no secret appears in Git. Consult provider behavior and inspect protected state schemas. Avoid outputting secret material unless a consumer genuinely needs it.

State access can reveal attack paths: resource IDs, internal hostnames, account layout, IAM names, network ranges, and trust relationships. Apply least privilege to read as well as write. Separate human troubleshooting access from the automated backend role and require temporary elevation for production state where appropriate.

Remote state references create trust relationships between stacks. A consumer that reads another stack's outputs may learn sensitive data or depend on mutable state. Publish only the narrow interface required, authorize exact consumers, and avoid giving a lower environment access to production state merely for convenience.

Workspace names or variable files alone are weak environment boundaries when the same credentials and backend can access every environment. Prefer provider-account or project separation, distinct roles, and distinct backends so an incorrect variable cannot redirect a development apply into production.

Backend bootstrap deserves design. The storage, encryption key, and locking mechanism that protect state may need to exist before the main stack. Manage their lifecycle through a separately protected foundational path and prevent ordinary stack deletion from removing its own state safeguards.

Backups should be versioned and protected against both accidental deletion and malicious overwrite. Restore tests need to confirm not only file retrieval but that resource addresses, provider configuration, and locking can safely produce a plan from the restored version.

Retention must match infrastructure and incident lifetime. Deleting old state immediately can remove evidence of who managed a compromised resource or make rollback investigation impossible. Retention also increases sensitive-data exposure, so set deliberate access and deletion policy.

## Why Are Modules and Providers Supply-Chain Dependencies?
<!-- section-summary: Modules contribute infrastructure declarations and providers execute cloud API behavior, so versions, sources, resolution, update review, and build authority are supply-chain controls. -->

Modules reduce duplication and can encode safe patterns. They are also dependency code. A module update can create resources, broaden IAM, alter network rules, or change lifecycle behavior across every consumer.

Pin module versions or immutable references. A moving branch allows module behavior to change without a caller-repository diff. Record source, version, and integrity where tooling supports it.

Pinning does not mean never updating. Old modules retain vulnerabilities, unsafe defaults, and incompatibilities. Use reviewed update pull requests, inspect source and plan differences, test in lower environments, and roll out gradually.

Providers are especially powerful dependencies. They translate declarations into API calls and often execute inside the privileged IaC process. A compromised provider can read configuration and credentials, alter plan or apply behavior, or call unexpected services.

Pin provider versions and use the dependency lockfile and verified distribution mechanism. A version range without a reviewed lock can select new provider code on a later build. Protect mirrors and plugin caches from poisoning.

Provider and module updates are software supply-chain events. Review publisher and source identity, release notes, code or provenance where available, new permissions, plan changes, compatibility, and rollback.

Module code can cause indirect execution through provisioners, external data sources, templates, and provider features. Avoid arbitrary local or remote execution where declarative resources can express the state. If scripts remain necessary, treat them as privileged build dependencies.

Private module registries need namespace and publication controls. A familiar internal module name is not safe if an unauthorized publisher can replace its version or if the resolver can fall back to a public source.

Review module source recursively. A trusted root module can call another module from a moving branch or execute an external helper. Lock or pin the complete dependency tree where the tooling permits, and restrict network resolution to approved sources.

Provider installation is code execution on the IaC runner. The provider receives configuration, may receive cloud credentials, reads state, and issues API calls. Verify checksums and signatures available through the ecosystem, use trusted mirrors, and isolate plugin caches across trust zones.

The dependency lock file records selected provider versions and hashes for platforms. Commit and review it. A changed checksum may be legitimate for a new platform or provider build, but it deserves explanation rather than automatic acceptance.

Module registries and provider mirrors need audit and incident response. If one source is compromised, responders should identify which runs resolved the affected version and which resources those applies changed. Record dependency identities with plan and apply evidence.

Version constraints should balance reproducibility and maintenance. An exact lock controls the current run. A declared compatible range communicates update policy. Automated proposals can intentionally update the lock; production does not resolve an unreviewed provider version spontaneously.

Canary dependency updates in lower environments, but inspect production plans too. Environment-specific resources, scale, policies, and state can cause the same module version to produce different transitions. A staging no-op does not prove production is safe.

Remove unused modules, providers, and provisioners. Dormant dependencies create patch and compromise surface and can remain in caches or lockfiles long after the resource path disappears.

## How Does Policy Evaluate Dangerous States and Transitions?
<!-- section-summary: Policy as code evaluates configuration or plan data for environment-aware reachability, IAM, data protection, destructive change, and approved exceptions before apply. -->

Policy as code answers “Is this requested infrastructure state and transition allowed?” It can evaluate source configuration for early feedback or plan JSON for resolved semantic change.

Examples include:

- Deny public database ingress in production.
- Deny wildcard administrative IAM grants.
- Require encryption, audit, backup, and deletion protection for classified data.
- Require additional approval for delete or replacement of stateful resources.
- Restrict providers, regions, module sources, and public endpoints.

Destructive-change policy is a security control. Accidental deletion can destroy evidence, backups, keys, or customer data. A plan that replaces a database deserves different review from an in-place tag update.

Identity changes need special review because they can weaken every other control. Show added actions, resources, trust principals, role-passing paths, and outer boundaries. A small string diff can create an escalation path.

Network changes deserve the same treatment. Translate CIDRs, routes, peers, gateways, and endpoint policy into effective reachability. Ask which actor can reach which asset and capability after apply.

Environment context should come from trusted pipeline configuration, account identity, state backend, or protected workspace, not only an editable variable. Otherwise a production plan can label itself development to bypass stricter rules.

Avoid excessive policy noise. Start with high-confidence consequences, supply actionable messages, measure false positives, and add architecture context. A rule everyone bypasses is not a strong control.

Exceptions need exact resource and policy scope, owner, reason, compensating control, approval, and expiry. Do not add a broad scanner ignore to make one plan green. Preserve the decision with the apply evidence.

Version and test policy. Fixtures should cover allowed, denied, destructive, unknown, malformed, environmental, and excepted cases. Protect who can update policy data and enforcement.

Policy can evaluate destructive transitions by resource class and environment. Deleting a temporary development instance may be allowed. Replacing a production database, encryption key, state backend, audit sink, or identity boundary can require an additional approval and a recovery reference.

IAM policy analysis should normalize actions, resources, principals, conditions, role passing, and trust. A generated policy may assemble wildcard authority across several fragments even though no single HCL line appears broad. Plan-level structured policy helps expose the effective grant.

Network policy should consider IPv4 and IPv6, inbound and outbound, public IP assignment, load balancers, peering, private endpoints, routes, DNS, and resource policy. Blocking one obvious CIDR does not prove private reachability.

Data protection policy can require encryption but should also evaluate key ownership and access. “Encrypted with provider default” and “encrypted under a customer-controlled key with narrow decrypt permission” provide different control. The correct requirement follows data classification and operational need.

Policy should detect removal of logging, retention, versioning, backup, lock, or deletion protection. These changes may not expose data immediately but weaken evidence and recovery needed after a compromise.

Environment context must be non-forgeable relative to the decision. Derive account or project ID from authenticated provider context, backend from the protected workspace, and workflow identity from the CI platform. Compare those signals instead of trusting one `var.environment` value.

Exceptions should be machine-discoverable so expiry can block or alert automatically. Preserve the original finding and plan; an exception authorizes a bounded transition, not a conclusion that the rule was wrong.

Policy noise is a design signal. Repeated legitimate exceptions may mean the architecture needs a distinct resource type or policy tier. Repeated false positives may mean the scanner lacks module or environment context. Improve the rule rather than teach everyone to bypass it.

## How Should Plan and Apply Identities Be Separated?
<!-- section-summary: Proposed changes may receive enough read authority to create a plan, while only a protected apply job obtains temporary environment-specific write authority after review and policy. -->

Control who can apply. A plan is evidence; apply changes reality. Pull requests should not automatically inherit production write authority merely because they need infrastructure feedback.

A planning identity may read provider metadata and state. This can still expose sensitive architecture, so scope it. It should not create, delete, change IAM, or write state.

The apply identity should appear only after protected review, required scans and policy, final plan approval, and production environment authorization. Give it the actions and resources needed for managed infrastructure, not an administrator role over the whole cloud.

Separate plan and apply credentials where useful:

```text
pull request -> read-oriented plan role -> proposed plan evidence
protected apply -> temporary write role -> approved resources only
```

CI should not need permanent cloud credentials. Use workload identity federation such as OIDC to exchange repository, workflow, ref, audience, and environment claims for a short role session. Revoke old static keys after migration.

Trust policy and permission policy both matter. Trust decides which workflow may become the role. Permission decides which infrastructure it can change. Narrow trust with broad permissions or broad trust with narrow permissions remains incomplete.

Least privilege applies to the runner too. A self-hosted runner with an attached administrator instance role bypasses workflow permission design. Use isolated ephemeral runners, minimal machine identity, controlled network, and short job identity.

Avoid an omnipotent apply system. Split accounts, environments, or major domains so compromise cannot change everything. An identity managing network infrastructure may differ from an application stack role, with explicit interfaces between them.

The strongest invariant is that ordinary production changes come through the controlled IaC path. Direct console or CLI authority is narrow, temporary, and auditable. Cloud logs should show the expected workload session for each apply.

Plan and apply separation should preserve exact input. A saved plan can bind the approved transition, but it may contain secrets and become stale after live changes. If the platform regenerates a final plan at apply time, compare it with the approved source and policy and require another decision when material actions differ.

Pull-request plans from untrusted branches must not execute arbitrary provisioners or external data programs under production credentials. Planning can invoke provider reads and tooling. Use isolated runners, low-privilege roles, controlled dependencies, and safe evaluation modes.

Approval should identify the source revision, plan or final action set, target account, state backend, module and provider versions, and exception set. “Apply main” is not a durable authorization subject when those inputs can change.

The apply role should not change its own trust policy, permission boundary, audit log destination, state backend protection, or CI federation unless that capability is the explicitly reviewed stack purpose and protected by another outer control.

Split large authority domains. A central network stack, security logging stack, IAM foundation, and application service can have different state, ownership, and apply roles. Cross-stack outputs form explicit interfaces. This limits one compromised application repository from changing organization-wide controls.

Federation trust should require the protected IaC repository and workflow, source context, audience, and production environment. A developer fork or similarly named repository should fail. Test negative token claims and audit every successful role session.

Remove static cloud keys, local credential files, and runner instance profiles that can perform apply after federation works. An unused alternate path remains a compromise path.

## How Do State, Apply Evidence, Break-Glass, and Recovery Fit Together?
<!-- section-summary: A production change needs durable state integrity, protected apply and cloud audit records, a narrow emergency path, and recovery plans that understand irreversible infrastructure effects. -->

Apply logs become security evidence. Record source revision, plan identity or digest, modules and providers, policy results, approvers, apply workload identity, state backend, start and completion, resource actions, errors, and outputs without exposing secrets.

Connect cloud audit events back to the IaC run. Provider logs should show the temporary apply role making expected API calls. An unexpected human or service identity reveals an alternate change path.

Protect state backend and locking. Monitor state writes, forced unlock, import, move, remove, backend changes, and restore. These operations can change what the tool believes it owns and make the next plan surprising.

Break-glass still exists for incidents or failure of the normal system. Use a named or strongly governed emergency identity, exact reason, time limit, alerts, action logs, and post-incident review. Reconcile every direct change into code and state afterward.

Rollback differs from application deployment. Applying an old configuration does not necessarily restore deleted data, old IPs, rotated keys, or provider state. Review the reverse plan and use service backups or recovery procedures for irreversible effects.

Test state restore, backend recovery, provider rollback, and break-glass before an incident. A backup is not recovery evidence until restored in a controlled exercise.

Plan and apply can partially fail. Investigate which resources changed, refresh carefully, preserve logs, and avoid repeatedly applying without understanding live and recorded state. A failed job does not mean no infrastructure changed.

If state is suspected compromised, stop ordinary apply, preserve versions and audit, compare live resources, identify unauthorized changes, restore or reconstruct under controlled review, and rotate identities that could write it.

Apply evidence should distinguish intended actions, successful provider calls, failures, retries, and final live state. The IaC tool can report completion while a managed service continues changing asynchronously. Verification should wait for relevant readiness and query critical security properties.

Break-glass may need two paths: emergency cloud access and emergency state-backend access. Keep them separately protected and tested. Ability to change cloud resources without updating state creates drift; ability to rewrite state without cloud change can make the next apply destructive.

After emergency use, decide whether to revert, codify, or import each live change. Update code, state, and evidence through review. Revoke the temporary session and check audit logs for every action, not only the final resource value.

Recovery planning should name service-specific objectives. Recreating infrastructure may not restore data. A previous state version may refer to a resource that no longer exists. Backups need restore time and integrity testing. DNS, keys, certificates, and external integrations may require separate recovery steps.

Prevent one apply system from becoming omnipotent through convenience. If it can read all secrets, administer IAM, disable logging, destroy backups, change networking, and deploy every workload, compromise defeats multiple independent controls. Use outer organization policy and distinct foundational roles.

Apply logs and cloud audit should be retained outside the runner and protected from the apply identity. An attacker using that identity should not be able to erase the only record of what changed.

## What Does a Secure IaC Delivery Path Look Like?
<!-- section-summary: A secure path reviews source and supply-chain inputs, generates and protects a semantic plan, applies environment-aware policy, authorizes one temporary least-privilege apply identity, and verifies live state and evidence. -->

A production flow is:

```text
IaC pull request
  -> module and provider identity review
  -> secret and static IaC scans
  -> protected state read and semantic plan
  -> plan scanning and environment-aware policy
  -> accountable source and plan approval
  -> protected production environment
  -> temporary least-privilege apply identity
  -> locked state update and cloud API events
  -> live-state, perimeter, IAM, and data verification
```


_The controlled path binds requested state, predicted transition, policy, authority, execution, and live verification._

The plan is therefore security evidence, not just a preview for operators. It should be tied to the reviewed commit and applied without an unreviewed regeneration, because a newly calculated transition may differ from the object that scanners and reviewers approved.

A first-principles risk model asks what can be reached, who gains capability, which data can be exposed or destroyed, how widely compromise propagates, and whether recovery exists. Scan rule severity is one signal inside that model.

A useful review sequence is:

1. Read the human intent and affected environment.
2. Inspect configuration and dependency changes.
3. Read the plan for creates, updates, replacements, and deletes.
4. Trace network and identity consequences.
5. Review secrets, state, data protection, and recovery.
6. Evaluate policy and exception evidence.
7. Confirm apply identity and protected path.
8. Verify the live result and audit chain.

The production checklist covers protected source, pinned modules and providers, frozen dependency resolution, secret detection, secured state and plans, policy tests, separated environments, plan-only pull-request authority, temporary apply identity, stable evidence, live drift detection, break-glass, backups, and recovery tests.

The deepest model is an authority transition:

```text
reviewed declaration
  -> predicted semantic change
  -> allowed state and transition
  -> authorized caller
  -> real cloud mutation
  -> verified and recoverable reality
```

The chain of evidence for one production change should include pull request and owners, source revision, scan and secret results, module and provider resolutions, plan, policy bundle and decisions, exception approvals, target environment, temporary apply session, state change, cloud audit events, live verification, and any rollback or reconciliation.

Test the complete path using negative cases: public database, wildcard IAM, destructive replacement, unsigned or unexpected provider, unapproved module source, pull-request apply attempt, staging identity against production, stale plan, concurrent lock, expired exception, and missing policy service. Each should fail at the intended boundary with useful evidence.

Also test the positive path and recovery. A normal change should move without hidden administrator intervention. A controlled partial failure should be recoverable without state editing by guesswork. A retained state backup should restore into a safe reviewed plan.

Scan before merge to protect the proposed transition, after merge to detect changed analysis and historical debt, and continuously to detect drift and new policy. These stages answer different questions and should not be reduced to duplicate jobs.

Security scanners should understand intent where possible. Resource tags, module contracts, data classification, owner catalogs, and environment metadata can supply context. Keep that data protected and current so richer policy does not become a new source of false trust.

The strongest production invariant can be stated and tested: every ordinary cloud mutation to managed resources is attributable to the controlled temporary apply identity and corresponds to reviewed source and plan evidence. Any other caller or unmanaged resource is a finding that requires explanation.

Review plan credentials as a data boundary. Provider reads can expose resource configuration, secret metadata, network topology, and existence of sensitive services. Limit the accounts and APIs a speculative pull-request plan can query, redact untrusted output, and avoid returning full production state to forked or unreviewed code.

Review apply concurrency across stacks as well as inside one state lock. Two separate state files can modify the same cloud resource, IAM policy, network route, or DNS zone without sharing a lock. Establish ownership boundaries and detect overlapping management before controllers fight or overwrite one another.

IaC import and state-move operations are high-impact transitions even when no provider API call occurs. Moving an address can change ownership relationships; removing an object from state can leave unmanaged production infrastructure; importing the wrong resource can make the next plan destructive. Require review and retain before-and-after state evidence.

Provider aliases and multiple accounts deserve explicit policy. A module can use a provider alias that points to another region or production account. Verify the authenticated account and provider mapping in the plan and apply evidence instead of trusting a variable or alias name.

Data sources can create hidden mutable inputs. A build may query “latest image,” current network, external file, or remote secret and then use the result in the plan. Record resolved values that affect security and prefer immutable identifiers for release artifacts and modules.

IaC is different from application deployment because convergence can update and delete shared long-lived resources in place. There may be no independent old artifact to redeploy. Design migrations, backups, and rollback around resource semantics, not a generic “revert commit” button.

Security review should ask about lifecycle after apply. Who owns the resource, how will drift be detected, when will temporary access expire, which logs show use, how will dependencies update, and how will the resource be decommissioned? Safe creation without safe maintenance produces future debt.

Connect change records to runtime inventory. A plan can show that firewall F changed, while service topology shows which applications and data depend on F. This context improves impact review and incident response when an apply behaves unexpectedly.

Test policy against provider upgrades. Schema changes, unknown-value behavior, and plan JSON differences can cause rules to miss or overblock. Canary the provider and policy engine together and preserve fixtures from production resource shapes.

Finally, review the controlled path itself as infrastructure. CI environments, OIDC trust, runners, state backends, policy engines, module registries, provider mirrors, and audit sinks are privileged services. Manage them through separate protected foundations so an application stack cannot weaken the system that approves its own changes.

A production review can make these ideas concrete with five linked questions. First, what state is the declaration asking production to have? That includes resources, exposure, identities, dependencies, and data protection. Second, what transition will the generated plan use to reach that state? A seemingly small edit may replace a resource, remove a protection, or expand a principal's authority. Third, do versioned policies allow both the destination and the transition in this environment? Fourth, which temporary identity can make the plan real, and what prevents an untrusted pull request from acquiring that identity? Fifth, what evidence proves the result and what recovery action is safe if reality differs from the reviewed plan?

Those questions also clarify why a passing scanner is not the end of review. A source rule may recognize an unsafe literal value but miss a value resolved by a module or data source. A plan rule may see the resolved change but not guarantee that live infrastructure remains unchanged before apply. A successful apply may still produce a runtime perimeter or identity relationship that must be verified through cloud inventory and audit records. Each control observes a different point in the authority transition.

Treat review artifacts according to their sensitivity. Plans, state snapshots, provider diagnostics, and audit records can reveal resource names, topology, account identifiers, and secret-bearing values. Restrict their readers, redact displayed output where possible, retain only what the evidence policy needs, and protect deletion separately from the identity that performs the change. Evidence is useful only when responders can trust it and attackers cannot conveniently erase it.

## Check Your Answers

:::expand[Why Is Infrastructure Configuration Unusually Powerful Code?]{kind="recap"}
IaC declares large real-world states, and its plan reveals the create, update, replacement, and deletion actions required to reach them.
:::

:::expand[How Do Source Scans and Plans Reveal Different Risk?]{kind="recap"}
Static scans catch declared patterns early; plan analysis exposes resolved resources and transitions; live verification closes their modeling limits.
:::

:::expand[How Should Secrets, State, and Environments Be Protected?]{kind="recap"}
Keep secrets out of source, protect state, plans, logs, locking, and backups, and separate production identity, backend, network, keys, and data.
:::

:::expand[Why Are Modules and Providers Supply-Chain Dependencies?]{kind="recap"}
Pin and review module declarations and provider executables, control their sources and resolution, and update through tested semantic plans.
:::

:::expand[How Does Policy Evaluate Dangerous States and Transitions?]{kind="recap"}
Use trusted environment context to evaluate reachability, IAM, data protection, destructive action, dependencies, and exact expiring exceptions.
:::

:::expand[How Should Plan and Apply Identities Be Separated?]{kind="recap"}
Give proposed changes constrained plan visibility and grant temporary environment-specific write authority only to the protected apply path.
:::

:::expand[How Do State, Apply Evidence, Break-Glass, and Recovery Fit Together?]{kind="recap"}
Protect and audit state and apply, reconcile emergency changes, handle partial failure, and test recovery for irreversible infrastructure effects.
:::

:::expand[What Does a Secure IaC Delivery Path Look Like?]{kind="recap"}
Bind reviewed declaration, semantic plan, policy, approval, temporary apply identity, provider events, state, live verification, and recovery evidence.
:::

## References

- [Terraform plan](https://developer.hashicorp.com/terraform/cli/commands/plan) - Describes speculative and saved execution plans.
- [Terraform state security](https://developer.hashicorp.com/terraform/language/state/sensitive-data) - Describes sensitive values and remote state protection.
- [Terraform dependency lock file](https://developer.hashicorp.com/terraform/language/files/dependency-lock) - Documents provider version and checksum locking.
- [OpenTofu state and backends](https://opentofu.org/docs/language/state/) - Describes resource state and remote backend behavior.
- [GitHub OIDC security hardening](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - Documents temporary workload federation for CI.
- [OPA Terraform policy tutorial](https://www.openpolicyagent.org/docs/latest/terraform/) - Demonstrates policy evaluation over Terraform plans.
