---
title: "Securing CI/CD Runners"
description: "Learn how runner trust zones, ephemeral machines, job routing, secret and network boundaries, isolated state, and auditable lifecycle controls contain pipeline code execution."
overview: "Treat the runner as the computer that executes repository-controlled recipes. Classify who can send code, separate low-trust pull-request work from privileged delivery, compare hosted and self-hosted machines, make sensitive runners ephemeral, isolate caches and artifacts, reduce network and secret reach, harden the trusted computing base, and investigate a runner compromise through all downstream outputs."
tags: ["devsecops", "pipeline-security", "ci-cd", "runners"]
order: 1
id: article-devsecops-pipeline-security-securing-cicd-runners
---

## Table of Contents

1. [Why Is a CI/CD Runner a High-Risk Computer?](#why-is-a-cicd-runner-a-high-risk-computer)
2. [How Do Hosted, Self-Hosted, and Ephemeral Runners Differ?](#how-do-hosted-self-hosted-and-ephemeral-runners-differ)
3. [How Do Trust Zones and Job Routing Contain Pull Requests?](#how-do-trust-zones-and-job-routing-contain-pull-requests)
4. [What State Can Survive Between Runner Jobs?](#what-state-can-survive-between-runner-jobs)
5. [How Do Secrets, Identity, and Network Reach Become Runner Privilege?](#how-do-secrets-identity-and-network-reach-become-runner-privilege)
6. [What Belongs in the Runner's Trusted Computing Base?](#what-belongs-in-the-runners-trusted-computing-base)
7. [How Do You Detect and Respond to a Runner Compromise?](#how-do-you-detect-and-respond-to-a-runner-compromise)
8. [What Does a Secure Runner Architecture Look Like?](#what-does-a-secure-runner-architecture-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A workflow file is a recipe. The **runner** is the computer that follows it.

```yaml
steps:
  - uses: actions/checkout@v4
  - run: npm ci
  - run: npm test
```

Those lines cause a machine to download source, execute a third-party action, run package-manager hooks, launch build scripts, and execute repository tests. The YAML may look declarative, but the runner is performing general-purpose code execution.

That code can come from several trust levels: reviewed source on a protected branch, a new pull request, a dependency maintainer, an action publisher, a generated script, or an artifact produced by another job. The runner may simultaneously have a platform token, secret values, package credentials, cloud identity, network access, caches, artifacts, and writable disk.

This creates the core runner risk:

```text
code execution
      +
reachable authority and state
      =
possible job impact
```

A tiny test job already raises security questions. Who can change `package.json` and its install hooks? Which token does checkout receive? Can the job read repository secrets? Is the machine connected to an internal network? Does its filesystem contain material from a previous run? Can the output later enter a privileged deployment?

Keep these questions in view as you work through the lesson:

1. **Why Is a CI/CD Runner a High-Risk Computer?**
2. **How Do Hosted, Self-Hosted, and Ephemeral Runners Differ?**
3. **How Do Trust Zones and Job Routing Contain Pull Requests?**
4. **What State Can Survive Between Runner Jobs?**
5. **How Do Secrets, Identity, and Network Reach Become Runner Privilege?**
6. **What Belongs in the Runner's Trusted Computing Base?**
7. **How Do You Detect and Respond to a Runner Compromise?**
8. **What Does a Secure Runner Architecture Look Like?**

## Why Is a CI/CD Runner a High-Risk Computer?
<!-- section-summary: A runner executes repository code and dependencies while holding delivery context, so any reachable credential, network, state, or output becomes part of the job's possible authority. -->

Runners are unusually sensitive because delivery systems sit near source, signing, registries, clouds, and production. A compromised developer laptop is serious. A compromised runner can alter what many users receive or can turn reviewed source into a different released artifact.

Start by classifying trust:

The answer should describe the complete execution environment, not just the workflow token. A read-only token does not make a runner read-only when the machine has a cloud instance role and private network access.

The job identity and runner identity are conceptually separate. The CI platform can issue a short-lived token for one workflow. The operating system or hosting platform may also give the machine an instance profile, service account, local credential helper, or socket capable of controlling other workloads. Effective authority is the union.

The first-principles objective is not “harden one powerful runner enough for everything.” It is to ensure that code from one trust zone cannot inherit the authority or state of another.

Runner risk is asymmetric because a small input can influence a large output. One modified build script may execute for minutes but create an image deployed to thousands of instances. A poisoned package cache can affect later builds that never saw the original pull request. A stolen signing or registry credential can make attacker-controlled content appear to follow the normal release path.

Treat every executable input as code, even when it is not stored under `src/`. Workflow expressions can alter shell commands. Build configuration can load plugins. Test data can trigger parsers. Makefiles, container build instructions, compiler configuration, package lockfiles, and setup actions all shape execution. Review “who can send code” broadly enough to include these indirect paths.

The runner also observes sensitive data produced during legitimate work. Source from private repositories, unreleased binaries, test reports, customer-like fixtures, dependency credentials, and provenance may all pass through memory or disk. Confidentiality therefore matters even for a job with no deployment power.

## How Do Hosted, Self-Hosted, and Ephemeral Runners Differ?
<!-- section-summary: Hosted and self-hosted runners trade control, connectivity, and lifecycle responsibility, while ephemerality removes persistent machine state after one job but does not erase authority during execution. -->

A **hosted runner** is supplied and managed by the CI provider. For many workflows, the provider creates a fresh virtual machine for a job, installs a known toolset, and destroys the machine afterward. The team gets low maintenance, ordinary Internet connectivity, and strong default cleanup without owning the host lifecycle.

A **self-hosted runner** is a machine the organization registers and manages. It may be physical hardware, a virtual machine, a container, or an automatically created cloud instance. Self-hosting can provide specialized hardware, private network reach, custom tools, performance, data residency, or cost control. It also transfers patching, hardening, credential, cleanup, capacity, and incident-response responsibility to the organization.

The most dangerous common pattern is a long-lived self-hosted runner that accepts pull-request code and also holds production secrets or sits inside a trusted network. A malicious change can execute on the same machine where later privileged jobs run. Persistence, shared disk, runner service identity, network adjacency, and cached credentials turn one low-trust execution into a path toward later authority.

**Ephemeral runners** change the model. Provision a runner for one job, register it, execute the workload, collect intended output and logs, then destroy the machine. Persistence must cross a controlled artifact, cache, registry, or logging boundary rather than remaining unnoticed on local disk.

```text
job requested
    |
    v
create runner from approved image
    |
    v
register for one bounded job
    |
    v
execute and export intended evidence
    |
    v
destroy machine and revoke registration
```

Ephemerality does not make the job harmless. Malicious code can still use every credential and network path available during that run. A compromised golden image can affect every new runner. Artifacts and caches can carry malicious state forward. The value of ephemerality is that it removes the assumption that cleanup scripts can reliably return a compromised machine to a trusted condition.

A clean workspace is necessary but not equivalent to a clean machine. Deleting the repository directory does not remove changed system binaries, scheduled tasks, background processes, Docker layers, host-level credentials, tool configuration, kernel state, or files elsewhere on disk. Reimaging or destroying the machine provides a stronger lifecycle boundary.

Hosted and self-hosted are not simple secure/insecure labels. A provider-hosted machine with broad secrets can be dangerous during the job. A well-isolated ephemeral self-hosted runner can be appropriate for private deployment. Choose from workload needs, then design trust zones, authority, network, state, and lifecycle explicitly.

Containers can improve dependency isolation and reproducibility, but a container is not automatically a hard boundary against hostile code. Privileged mode, host mounts, shared kernels, and powerful sockets can expose the host. Treat container configuration and underlying host isolation as part of the security design.

Long-lived machines accumulate configuration drift. Operators install debugging tools, change permissions, add certificates, retain old runtime versions, and create exceptions so one job succeeds. Over time, the actual runner differs from its documented baseline. Replacing instances from a controlled image limits this uncontrolled history and makes the execution environment easier to reproduce.

Ephemeral registration matters as much as ephemeral compute. A destroyed virtual machine should not leave a reusable runner credential that another machine can present. Scope registration, remove the runner after its assignment, and alert when the same logical identity reconnects unexpectedly.

Capacity design can affect security. If the secure ephemeral pool is slow or frequently unavailable, teams may route work to a permanent shared runner. Provision enough capacity and make safe routing the ordinary path, not an exception that users feel compelled to bypass.

## How Do Trust Zones and Job Routing Contain Pull Requests?
<!-- section-summary: Runner groups and routing policy should keep proposed code on low-authority machines and send reviewed build and deployment work to separate environments with only the authority each transition needs. -->

Trust zones group executions with comparable input trust and authority. One practical model is:

```text
Zone 1: external or proposed pull-request checks
Zone 2: protected-branch builds
Zone 3: staging deployment
Zone 4: production deployment
```

Mixing the zones allows low-trust code to inherit high-trust machine properties. A pull request may plant state for a later main-branch job, read a shared cache, reach internal services, or exploit the runner service. Separating jobs in YAML is insufficient if they still land on the same persistent host.

Pull requests belong on the low-trust path. They execute proposed code, package hooks, test fixtures, and changed scripts before acceptance. This remains true for employee-authored branches; internal accounts and dependencies can be compromised, and repository membership is not production authorization.

A pull-request zone should normally use provider-hosted or isolated ephemeral machines, read-heavy platform permissions, no production secrets, no privileged cloud role, no sensitive internal network route, and separate caches. The job can produce test and scan evidence without gaining deployment authority.

Testing and deployment should be separate. A protected build creates an identified artifact after review. A deployment runner consumes that digest and executes a small, predictable promotion path. It should not check out and run arbitrary proposed source under production authority.

**Runner groups** can restrict which repositories or organizations may target a runner set. **Labels** help jobs select capabilities such as operating system, architecture, GPU, or deployment tier. Labels alone are not a strong boundary if any repository can request the label or any administrator can attach it to a different machine. Combine labels with group access policy, protected workflows, environments, and external authorization.

Job routing is a security control because it decides which code meets which machine. Review:

- Which event and repository may request the group?
- Can a pull request edit the routing label or workflow?
- Which branch or environment is required?
- Who administers group membership and labels?
- What happens when no appropriate runner is available?
- Can a fallback route the job to a more privileged pool?

Do not let convenience cause an automatic fallback from an isolated pool to a broad internal runner. A missing safe runner should delay the job rather than silently expand its trust boundary.

The authorization rule should use properties a pull request cannot freely control. A label written directly in workflow YAML is weak when proposed code can edit that YAML and target a privileged label. Protect workflow definitions, restrict group use to selected repositories, and combine routing with branch or environment policy evaluated outside the untrusted job.

Separate zones even when they need the same toolchain. Reuse a reviewed base image rather than the same running host. Consistent compilers and packages can come from immutable image versions, while machine identity, filesystem, and network remain distinct.

Consider service accounts used by the orchestration layer. A controller that creates ephemeral runners may need permission to create virtual machines or pods, register them, and attach network policy. Ordinary jobs should not inherit that controller credential. Compromise of the runner must not automatically become permission to create privileged sibling runners.


_Trust-zone routing prevents unreviewed code from sharing a machine, identity, network, or state boundary with privileged delivery._

This separation is a lifecycle control, not merely a runner label. The platform must authorize assignment, start the machine from an approved image, attach only the intended identity and network, accept one job, export the expected evidence, revoke registration, and destroy the host. Each stage can otherwise reopen a path between trust zones.


_Labels describe required capability; group and workflow policy decide whether the caller is authorized to reach that capability._

## What State Can Survive Between Runner Jobs?
<!-- section-summary: Workspaces, caches, artifacts, container layers, tool homes, and background processes can carry data or code across jobs, so every persistence path must respect the same trust zones as execution. -->

Runners process state even when the official input is source code. Workspaces contain checked-out files, generated configuration, temporary credentials, test databases, reports, and build outputs. A persistent machine can expose them to a later job.

Clean the workspace before and after a job, but do not treat that as host restoration. Files can live outside the repository. Processes may survive. Tools write to home directories. Docker keeps layers, images, volumes, and credentials. Package managers maintain global caches. A malicious job can intentionally hide state where ordinary cleanup does not look.

Caches are shared state by design. They improve speed by reusing dependencies or build results, but a low-trust job that writes a cache can poison a later trusted job. Cache keys, restore prefixes, and write permissions determine which trust zones can influence one another.

A safer pattern gives proposed code either read-only access to a cache created by a trusted process or a completely separate namespace. Do not let a pull request overwrite the dependency or compiler cache used by a production build. Include lockfile, toolchain, platform, and trust-zone identity in keys where appropriate, and validate restored content before execution.

Artifacts also cross boundaries. A pull-request artifact is attacker-controlled output even if CI uploaded it successfully. A privileged job must not execute it merely because it came from the platform artifact store. Define which job produced it, which revision it represents, how integrity is identified, and what later consumer may do with it.

Build once and promote an identified artifact. A trusted build can produce digest D with provenance and test evidence. Staging and production consume D instead of rebuilding on different runners. This reduces the number of machines capable of changing release bytes and lets responders trace outputs.

Artifact integrity does not establish trust in the producer. A digest proves content identity, not that a low-trust job created safe content. Admission must consider the builder and source context as well as the hash.

Containerized jobs introduce more state paths. Bind mounts expose host directories. The Docker socket often grants near-host control because a container can start privileged siblings or mount host files. Docker-in-Docker can create another daemon with its own persistence and privilege. Decide whether the isolation requirement is dependency convenience or containment against hostile code, then choose a boundary strong enough for the latter.

Every intended state transfer should be explicit:

```text
producer identity + input revision + artifact or cache digest
      -> storage boundary and retention
      -> authorized consumer and allowed operation
```

Everything else should disappear with the ephemeral machine.

Cache reads can execute code without an obvious `run` step. Restored compiler objects, package archives, generated scripts, or tool plugins may be consumed automatically. Sign or otherwise identify trusted cache producers where consequence warrants it, and prefer rebuilding over restoring state across a high-trust boundary when validation is weak.

Artifact stores need authorization and retention. A job should upload only its expected path and should not overwrite another run's identified object. Consumers should select by run, revision, and digest rather than a mutable “latest” name. Retain enough producer metadata to investigate which runner created the object.

Workspaces can leak in both directions. A later job may read an earlier secret, while an earlier malicious job may plant a script that a later job executes. Mounting the same directory into several containers does not create isolation between them. Either keep the jobs inside one acknowledged trust zone or use explicit handoff through verified outputs.

## How Do Secrets, Identity, and Network Reach Become Runner Privilege?
<!-- section-summary: Job code can turn reachable secret values, machine credentials, workload tokens, internal connectivity, and outbound access into executable power. -->

Secrets become power once exposed to the runner. Masking hides matching text from logs; it does not prevent a process from using the credential, transforming it, writing it to an artifact, or sending it over the network. The strongest protection is not presenting the credential to code that does not need it.

Separate permanent machine identity from job identity. A self-hosted runner with an attached production instance role gives every job on the machine ambient production authority. Prefer a minimal machine role used only to provision or register the runner, then let an authorized job obtain a short-lived, task-specific identity through OIDC or another federation mechanism.

The trust policy should bind repository, workflow, branch or tag, and protected environment. The permission policy should limit the resulting role to one service and operation. Short life limits the session window but cannot compensate for broad permissions.

Network access is privilege. A job without a secret can still query an unauthenticated internal service, metadata endpoint, database, control plane, artifact repository, or administrator interface because the runner sits inside a trusted network. Inventory reachable destinations and authentication assumptions.

Self-hosted runners inside a corporate LAN deserve special caution. Network location may implicitly bypass controls that would reject an external caller. Use dedicated subnets or segments, inbound restrictions, and explicit service authentication rather than treating the runner network as trusted.

Outbound restrictions can reduce exfiltration and command-and-control paths. A build may need source, package mirrors, artifact storage, and observability endpoints, not unrestricted Internet access. Allowlisting has operational cost and should be designed carefully, but unrestricted egress means any readable secret or source can be transmitted directly.

Network controls should follow the job. Pull-request runners may need only public package mirrors through a controlled proxy. A deployment runner may need one control-plane endpoint. Production database access is normally unnecessary for a deployment job. Denied connections provide evidence and potential detection signals.

Do not store powerful credentials in a local file for convenience. Ephemeral workload identity improves attribution and reduces standing secrets. Rotate or revoke any old static key after migration; retaining it as a hidden fallback preserves the original compromise path.

Metadata services deserve explicit treatment. Cloud virtual machines may obtain instance credentials through a local metadata endpoint even when no secret appears in workflow configuration. Block job access when the runner does not need it, use the strongest metadata protections available, and give the underlying instance only provisioning-level capability.

Private package mirrors and source services can also represent authority. A read credential may expose proprietary dependencies; a write credential can poison future builds. Separate read and publish paths, and do not let a pull-request runner modify the mirror used by protected builds.

Outbound control should include DNS and proxies. Allowing only approved IP addresses while a job can change name resolution or use an unrestricted proxy may not create the intended property. Test denied destinations from inside the actual runner and record those results.

## What Belongs in the Runner's Trusted Computing Base?
<!-- section-summary: The runner image, operating system, agent, tools, dependencies, container runtime, actions, plugins, provisioning system, and update process can all influence job execution and outputs. -->

The **trusted computing base** is the collection of components whose compromise can violate the security property. For a runner, it includes more than the operating system:

- Base image and provisioning pipeline.
- Kernel, system packages, and runtime libraries.
- CI runner agent and registration mechanism.
- Shell, language runtimes, package managers, and compilers.
- Container runtime and daemon configuration.
- Preinstalled actions, plugins, credential helpers, and tools.
- Root certificates, DNS, mirrors, proxies, and update sources.
- Logging and cleanup agents.

Dependencies are code execution too. `npm ci`, build plugins, compiler hooks, test frameworks, and setup actions can run with the job's authority. Pin and review delivery dependencies, constrain network access, and avoid placing secrets beside install steps that do not need them.

Golden images reduce uncontrolled drift. Build a reviewed runner image from declared inputs, scan and test it, identify it immutably, and replace instances rather than hand-editing long-lived hosts. Image version becomes evidence about the toolchain and patch level used for a job.

Golden does not mean permanently trusted. Patch the operating system, runner agent, container runtime, language toolchains, and foundational packages. CI machines process attacker-influenced code and therefore need prompt remediation for privilege-escalation and isolation defects.

Control image creation. If any runner can publish the next runner image into the trusted pool, a compromised job can persist through the provisioning layer. Use a separate protected image-building path with provenance, review, and promotion.

The runner agent itself needs least privilege. Avoid running the service as root when unnecessary. Restrict its filesystem, service account, group membership, and ability to manage sibling hosts. Registration tokens and administrative APIs should not be available to ordinary jobs.

Docker-in-CI deserves explicit threat modeling. Access to the host Docker socket can be equivalent to host root. Privileged containers weaken isolation. Nested daemons add complexity and state. If a job needs image builds, use an architecture designed for untrusted build workloads or isolate that capability in its own ephemeral trust zone.

Patch and image evidence should connect to job evidence. During an incident, responders need to know which image version, agent, tools, and host executed the affected run, not only which source revision was checked out.

Limit software multiplicity. Every preinstalled tool, plugin, daemon, and language runtime adds code that must be patched and trusted. Create focused images for workload classes instead of one universal runner containing every compiler, cloud CLI, deployment plugin, and credential helper.

Verify image behavior before promotion. Tests should confirm expected users and permissions, absence of old credentials, disabled unnecessary services, network and metadata restrictions, runner registration behavior, logging, cleanup, and the ability to execute only the intended workload class. A vulnerability scan alone does not prove these configuration properties.

Tool updates require movement without uncontrolled drift. Pin the approved image version for a run, build new image candidates automatically, test them, then roll pools gradually. Monitor job failures and security telemetry before completing replacement. Do not solve reproducibility by leaving a vulnerable image unchanged indefinitely.

## How Do You Detect and Respond to a Runner Compromise?
<!-- section-summary: Runner telemetry should reconstruct provisioning, assignment, identity, network, outputs, and destruction, while incident response assumes persistence and inspects everything the runner could influence. -->

Logs should explain the runner lifecycle:

```text
runner image and instance created
    -> registered identity and group
    -> job and repository assigned
    -> credentials or roles issued
    -> network and artifact actions
    -> job result and outputs
    -> deregistration and destruction
```

Record runner ID, image version, host or instance identity, job and workflow, repository and revision, event type, assigned group and labels, issued role sessions, artifact digests, relevant network events, and destruction result. Protect logs outside the runner so malicious code cannot erase the only record.

Detection should look beyond failed jobs. Unexpected outbound destinations, attempts to access metadata services, new background processes, changes outside the workspace, privilege escalation, Docker socket use, unusual artifact publication, credential access, runner registration changes, and jobs routed to the wrong group can indicate compromise.

For ephemeral pools, monitor lifecycle anomalies: an instance that remains after the job, a runner that accepts a second job, reuse of a registration credential, drift from the approved image, or output uploaded after termination should be investigated.

If compromise is suspected, assume persistence until disproved. Stop routing jobs to the affected group, revoke runner registration and active job or cloud tokens, destroy or isolate affected machines, preserve logs and forensic data where required, and rebuild from a trusted image. Cleaning a workspace is not sufficient evidence of recovery.

Investigate downstream outputs. A compromised runner may have altered artifacts, packages, signatures, provenance, caches, or deployment requests. Identify every output and environment influenced during the exposure window. Quarantine artifacts, revoke or supersede signatures as policy permits, invalidate poisoned caches, and redeploy known-good content.

Also investigate upstream control. Determine how code reached the runner, whether routing policy failed, which workflow or dependency changed, which image or agent was vulnerable, and whether similar runners share the condition. Fixing one instance without addressing the pool can repeat the compromise.

Incident severity follows possible authority, not merely observed commands. Use the runner's total privilege graph—tokens, secrets, machine identity, network, caches, artifacts, registries, and deployments—to bound what an attacker could have done.

Rotate credentials the runner could read even when logs do not show exfiltration. Malicious code may encode or transmit values in ways ordinary logging misses. The set includes platform tokens, registry credentials, package credentials, cloud sessions, signing access, internal service credentials, and any secrets left by prior jobs.

Use artifact and provenance records to identify downstream exposure. List every build, package, image, signature, and deployment produced by affected runner identities or image versions during the window. Compare digests with known-good rebuilds where reproducibility supports it. A clean host replacement does not repair an already distributed malicious artifact.

Detection rules should be tested through safe simulations. Confirm that unexpected egress, metadata access, persistence attempts, wrong-pool routing, and lifecycle failures create alerts with enough job and runner context for response. An alert that says only “suspicious process on host” may be too detached from the release graph to support containment.

## What Does a Secure Runner Architecture Look Like?
<!-- section-summary: A secure architecture separates trust zones, creates runners per job, removes standing authority, restricts networks and shared state, promotes immutable artifacts, and keeps privileged deployment deliberately small. -->

Consider an unsafe ParcelPulse design: one permanent self-hosted runner processes pull requests, builds main, publishes images, and deploys production. It has a permanent cloud key, access to the corporate LAN, a shared Docker daemon, reusable caches, and a workspace cleanup script.

An attacker thinks in paths:

```text
malicious pull request
    -> execute on persistent runner
    -> read key or use attached identity
    -> poison cache or persist on host
    -> alter later artifact
    -> reach registry, cloud, or production
```

Redesign it in layers.

First, separate trust zones. Pull requests use low-authority hosted or ephemeral runners. Protected builds use a separate pool. Staging and production deployments use distinct restricted groups.

Second, make sensitive runners ephemeral. Provision one approved image per job, register it for one assignment, and destroy it afterward. Do not rely on cleanup to reverse hostile host changes.

Third, remove permanent secrets and broad local identity. Use short-lived platform tokens and environment-bound workload federation. Give the production job one service deployment capability.

Fourth, restrict networking. Proposed code has no private production route. Build jobs use controlled mirrors and artifact endpoints. Deployment reaches only the intended control plane.

Fifth, isolate state. Use separate cache namespaces and write policy by trust zone. Treat artifacts from low-trust jobs as untrusted. Export only intended evidence from ephemeral machines.

Sixth, build once on the protected build path, identify the digest, and promote that object. The deployment runner should be boring: verify the approved subject, obtain a short role, perform one update, record the result, and disappear.

```text
pull request
  -> isolated test runner, read-only, no private network

protected revision
  -> ephemeral build runner, produces digest and evidence

staging approval
  -> staging deploy runner and staging role

production approval
  -> production deploy runner and one-service role
```


_Containment comes from multiple boundaries: who can send code, which machine runs it, what survives, what authority appears, what networks are reachable, and what evidence leaves the host._

A useful review model asks six questions:

1. Who can send code to this runner?
2. What repository code, actions, dependencies, and tools execute?
3. Which credentials, identities, sockets, files, and networks can the job access?
4. What state survives in workspaces, caches, containers, and artifacts?
5. Which packages, images, signatures, deployments, or other systems can the runner influence?
6. Which external logs and immutable identities reconstruct the lifecycle?

The strongest boundary separates code execution from authority. Pipelines need both, but they do not need to coexist at every stage. Keep proposed code capable of producing evidence, and reserve privileged transitions for small, isolated jobs that consume identified approved inputs.

The production deployment runner should be deliberately uninteresting. It does not compile, install a large dependency tree, run arbitrary tests, or accept pull-request scripts. It verifies approved metadata, obtains one short-lived deployment identity, calls the narrow control-plane operation, records the result, and is destroyed. Reducing code executed beside authority reduces opportunities for compromise.

The architecture still needs periodic review. Repository access changes, network routes grow, caches gain new consumers, images accumulate software, and environment roles expand. Re-run the six questions for each runner group and compare actual audit events with the intended matrix. Remove pools and relationships that no longer serve a current workload.

Runner security is ultimately path security. An attacker does not care whether a secret, socket, cache, or network route was considered a separate subsystem. They search for any path from code they influence to authority or output they value. The design must break the complete path.

Document the intended matrix beside the runner configuration and compare it with live assignments. If a repository, group, label, network route, cache namespace, or role no longer matches that matrix, treat the drift as a security finding with an owner. The review is complete only when policy and observed executions agree.

Recheck the matrix after adding a new runner pool, deployment environment, build capability, or shared cache because each one can create a new path between trust zones.

Record the review date and responsible platform owner so future operators know which assumptions were last verified and who must resolve drift.

Retain the evidence with the runner-group configuration.

Repeat the negative runner tests after every trust-boundary or assignment change.

## Check Your Answers

:::expand[Why Is a CI/CD Runner a High-Risk Computer?]{kind="recap"}
A runner executes repository and dependency code, so all reachable identity, secrets, network, state, and outputs become part of possible impact.
:::

:::expand[How Do Hosted, Self-Hosted, and Ephemeral Runners Differ?]{kind="recap"}
Hosted and self-hosted runners assign different operational responsibility; ephemerality removes persistent host state but not authority available during the job.
:::

:::expand[How Do Trust Zones and Job Routing Contain Pull Requests?]{kind="recap"}
Route proposed code to low-authority isolated pools and keep trusted builds, staging, and production on separate governed runner groups.
:::

:::expand[What State Can Survive Between Runner Jobs?]{kind="recap"}
Treat workspaces, caches, artifacts, container state, and tool homes as explicit cross-job trust paths rather than harmless performance details.
:::

:::expand[How Do Secrets, Identity, and Network Reach Become Runner Privilege?]{kind="recap"}
Withhold secrets from unnecessary code, replace ambient machine identity with bounded workload sessions, and treat internal and outbound connectivity as authority.
:::

:::expand[What Belongs in the Runner's Trusted Computing Base?]{kind="recap"}
Control and patch the image, OS, agent, tools, dependencies, container runtime, provisioning path, and update sources that can influence execution.
:::

:::expand[How Do You Detect and Respond to a Runner Compromise?]{kind="recap"}
Preserve external lifecycle evidence, revoke and rebuild rather than merely clean, and investigate every artifact, cache, registry, signature, and deployment the runner touched.
:::

:::expand[What Does a Secure Runner Architecture Look Like?]{kind="recap"}
Use separate trust zones, per-job machines, short-lived identities, constrained networks, isolated state, immutable promotion, and deliberately boring deployment runners.
:::

## References

- [GitHub self-hosted runner security](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#hardening-for-self-hosted-runners) - Describes risks of untrusted workflows on self-hosted runners.
- [GitHub runner groups](https://docs.github.com/en/actions/hosting-your-own-runners/managing-access-to-self-hosted-runners-using-groups) - Documents repository and organization access to runner groups.
- [GitHub ephemeral self-hosted runners](https://docs.github.com/en/actions/hosting-your-own-runners/managing-self-hosted-runners-with-actions-runner-controller/about-actions-runner-controller) - Describes autoscaled and ephemeral runner management.
- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use) - Covers workflow permissions, secrets, untrusted input, and runner security.
- [GitLab runner security](https://docs.gitlab.com/runner/security/) - Describes runner executor, token, privileged container, and self-hosted risks.
