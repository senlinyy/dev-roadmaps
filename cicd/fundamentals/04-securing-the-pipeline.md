---
title: "Securing the Pipeline"
description: "Learn how to preserve a verifiable chain of trust across source, workflows, credentials, dependencies, runners, artifacts, and deployment."
overview: "A delivery pipeline creates the software users eventually trust, so compromising the path can be as powerful as compromising production. This article builds pipeline security from threat modeling, short-lived identity, least privilege, code and dependency analysis, artifact evidence, runner isolation, policy gates, and recovery."
tags: ["security", "devsecops", "secrets", "provenance", "scanning"]
order: 4
id: article-cicd-fundamentals-securing-the-pipeline
aliases:
  - securing-the-pipeline
  - article-cicd-fundamentals-securing-the-pipeline
  - cicd/fundamentals/securing-the-pipeline.md
---

## Table of Contents

1. [Why Is the Delivery Pipeline Part of the Production Security Boundary?](#why-is-the-delivery-pipeline-part-of-the-production-security-boundary)
2. [How Should Pipelines Handle Secrets and Credentials?](#how-should-pipelines-handle-secrets-and-credentials)
3. [What Should Source, Dependency, and Image Scanning Establish?](#what-should-source-dependency-and-image-scanning-establish)
4. [How Do SBOMs, Digests, Signatures, and Provenance Protect Artifacts?](#how-do-sboms-digests-signatures-and-provenance-protect-artifacts)
5. [Why Are Runners and Pipeline Extensions Trust Boundaries?](#why-are-runners-and-pipeline-extensions-trust-boundaries)
6. [How Should Security Gates and Exceptions Be Designed?](#how-should-security-gates-and-exceptions-be-designed)
7. [How Do Review, Audit, Detection, and Recovery Protect the Chain?](#how-do-review-audit-detection-and-recovery-protect-the-chain)
8. [How Does a Complete Secure Delivery Path Work?](#how-does-a-complete-secure-delivery-path-work)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

A delivery pipeline is a machine that transforms source code into software users trust:

```text
source → build process → artifact → deployment → production
```

An attacker who controls that path may not need to attack a production server directly. They can change the source, weaken the workflow, steal a deployment credential, alter the build environment, replace an artifact, or cause an untrusted object to be promoted. Protecting production therefore requires protecting the process that creates production.

Security belongs inside delivery because timing changes impact. Discovering a leaked credential thirty seconds after a commit creates a smaller exposure window than discovering it six months later after someone has used it. Finding a vulnerable dependency before an artifact is published is cheaper than recalling a release already serving users. Security uses the same feedback economics as CI:

```text
change → security analysis → evidence → fix
```

The phrase **shift left** describes moving useful feedback nearer to the point where a problem enters the system. The phrase matters less than the outcome: earlier detection usually means a smaller blast radius and a less expensive correction.

Keep these questions in view as you work through the lesson:

1. **Why Is the Delivery Pipeline Part of the Production Security Boundary?**
2. **How Should Pipelines Handle Secrets and Credentials?**
3. **What Should Source, Dependency, and Image Scanning Establish?**
4. **How Do SBOMs, Digests, Signatures, and Provenance Protect Artifacts?**
5. **Why Are Runners and Pipeline Extensions Trust Boundaries?**
6. **How Should Security Gates and Exceptions Be Designed?**
7. **How Do Review, Audit, Detection, and Recovery Protect the Chain?**
8. **How Does a Complete Secure Delivery Path Work?**

## Why Is the Delivery Pipeline Part of the Production Security Boundary?
<!-- section-summary: The pipeline creates and promotes production software, so protecting production requires protecting every trusted step that leads to it. -->

Begin with the assets the pipeline protects. The chain includes source, workflow definitions, build scripts, credentials, dependencies, runners, artifacts, registries, infrastructure access, release decisions, and production. Each can become an attack path:

- malicious source can add unwanted behavior;
- a workflow change can skip checks or exfiltrate secrets;
- a compromised dependency can execute on the runner;
- an overprivileged credential can modify unrelated infrastructure;
- a compromised runner can alter the build or steal identity;
- a replaced artifact can put attacker-controlled bytes into production.

Pipeline files are privileged code. A step such as `run: ./deploy.sh` executes whatever the repository currently calls `deploy.sh`. If that job holds production credentials, controlling the script can mean controlling production. Workflow YAML, `Dockerfile`, `Makefile`, build scripts, deployment code, and related configuration deserve review comparable to production infrastructure.

A **threat model** makes the controls understandable. Ask who can propose or merge source, who can change pipeline files, which untrusted dependencies execute, which jobs receive secrets, where artifacts can be replaced, which runners reach private networks, and what production verifies. The answers reveal likely paths rather than producing an unconnected shopping list of scanners.

One threat path begins with a malicious source commit, continues through a workflow that exposes a credential, and ends with unauthorized infrastructure access. Another begins with a compromised package downloaded during installation; its lifecycle script executes on the runner and steals whatever identity the job possesses. A third leaves reviewed source untouched but uploads a different image under the expected release tag. The controls differ because the attacker enters at different links.

The threat model should include accidental changes too. A developer can remove a required scan, change a workflow trigger so release runs from an unprotected branch, or grant a test job write access while solving an unrelated problem. Review and machine policy protect the chain from mistakes as well as deliberate abuse.

Pipeline security is therefore chain-of-trust engineering. The objective is to maintain trustworthy identity and integrity from developer intent to the exact bytes running for users.

## How Should Pipelines Handle Secrets and Credentials?
<!-- section-summary: Secrets stay outside source, temporary identity replaces long-lived keys where possible, and each job receives only the authority it needs. -->

A Git repository records history. If commit A contains a database password and commit B removes the line, anyone able to read A may still recover the credential. The first invariant is simple: source should contain references to secrets, not secret material.

Application code can read `API_KEY` from its environment rather than embed the value. That alone is incomplete. A committed `.env` file still stores the secret in Git. The important separation is:

```text
secret manager or protected CI store
          ↓ controlled delivery
environment variable or mounted file
          ↓
authorized process
```

Humans make mistakes, so **secret scanning** looks for credential patterns in commits, pull requests, or pushes. It can recognize private keys, cloud credentials, and provider token formats. Internal systems may require custom patterns for organization-specific values.

Scanning is a detection layer, not an undo button. When a real credential enters Git, remove its authority first: revoke or rotate it, replace it in the authorized system, and investigate exposure. Deleting the latest line does not invalidate copies in history, clones, logs, screenshots, caches, or attacker tooling.

A leak response can follow a concrete sequence:

```text
scanner detects likely production key
        ↓
confirm credential and owner
        ↓
revoke or rotate immediately
        ↓
update authorized consumers
        ↓
inspect source history, CI logs, images, and manifests
        ↓
remove exposed material and add prevention where useful
```

Cleaning repository history can reduce future exposure, but it follows revocation because history rewriting cannot make an already copied credential powerless.

Credential design can reduce what scanners need to protect. A permanent cloud key valid for three years gives a thief a large opportunity. A token valid for fifteen minutes reduces the useful lifetime. One rough risk model is:

```text
credential risk ≈ privilege × lifetime × exposure
```

Reducing any factor helps. Modern CI platforms can often prove a workload identity to a cloud identity provider and receive temporary credentials:

```text
workflow identity and claims
          ↓ verified by provider
short-lived scoped credential
          ↓
specific deployment operation
```

The pipeline no longer stores a permanent cloud password. The provider can validate facts such as repository, workflow, branch, environment, audience, and commit before issuing a brief token.

This changes the secret problem into an identity-policy problem. The cloud trust rule must be narrow enough that an unrelated repository or pull-request workflow cannot present acceptable claims. The job should confirm which account and role it received before modifying infrastructure. Short lifetime limits reuse, while claim restrictions limit who can obtain the token in the first place.

**Least privilege** limits what the credential can do. A lint job reads source. A test job reads source and talks to an isolated test service. A build job may publish one package. A staging deployment may change staging only. A production deployment may change one production service. Giving every job full administrative access makes any compromised step a production compromise.

Authority includes more than API permissions. Filesystem access, network reachability, host capabilities, registry write access, signing ability, and secret visibility all grant power. A test job that cannot call a production API may still be dangerous if its runner can reach the private database directly.

Trust should rise gradually. Untrusted external input and pull-request code run with minimal permissions and no production secrets. Reviewed mainline code can enter a trusted build. A protected release job receives narrowly scoped temporary access. Production verifies the resulting artifact and evidence before accepting it.

## What Should Source, Dependency, and Image Scanning Establish?
<!-- section-summary: Different scanners examine different layers and provide risk evidence rather than proof that the software is secure. -->

Security analysis belongs at the point where its required input exists. Source is available during a pull request. The resolved dependency graph is available from manifests and lock files. Exact operating-system and application contents are visible after the release image is built.

**Static Application Security Testing**, or **SAST**, analyzes source without running the application. Rules and data-flow analysis can identify suspicious patterns involving injection, unsafe deserialization, weak cryptography, path traversal, or dangerous APIs. For example, concatenating user input into a SQL query can be flagged before the application runs.

```python
query = "SELECT * FROM users WHERE id = " + user_input
```

The analyzer can trace request input toward a database sink and warn that data may become executable query text. The safer implementation passes the value separately through the database driver's parameter mechanism. The security value comes from showing the developer the relevant path and fix, not merely producing a red count.

The result is evidence, not mathematical proof. A scanner operates with incomplete context and can produce a true vulnerability or safe code that resembles one. Thousands of unactionable alerts teach developers to ignore the system. Useful SAST points to the source, explains the path, and provides enough context for a person to evaluate the risk.

Dependencies are part of the shipped software. A small repository can import millions of lines through frameworks, parsers, database drivers, cryptography libraries, and transitive packages. **Software Composition Analysis**, or **SCA**, resolves the dependency graph and compares concrete versions with known vulnerabilities and policy information.

Lock files make the question precise. A manifest may allow a range of versions; the lock records which resolution the build uses. Security needs to know which software actually entered the artifact, including a vulnerable transitive library that the application never declared directly.

Dependency risk extends beyond known vulnerabilities. A package can have an incompatible license, be abandoned, use a suspicious new maintainer, introduce an unexpected transitive tree, or imitate a popular name through typosquatting. A dependency gate can combine vulnerability and license policy while keeping the reason for each decision visible.

Imagine application A depends on library B, which depends on vulnerable library C `1.8`. The team never wrote C in its top-level manifest, yet C still enters the build. The lock file exposes the exact path and version. A useful finding names the parent dependency, vulnerable version, fixed version, and whether the affected component is part of the released application or only development tooling.

Severity alone is insufficient. A high-severity advisory may affect an unreachable function in a development-only package, while a medium issue on an exposed production path can represent real risk. Ask whether the component is present, the vulnerable path is reachable, the service is exposed, a fix exists, and compensating controls reduce the threat.

A container image introduces another dependency tree. Its base image can include OpenSSL, libc, shells, package managers, runtime libraries, and utilities. **Image scanning** examines the built filesystem and metadata to identify operating-system packages, language libraries, known vulnerabilities, embedded secrets, and relevant configuration.

```text
release image
  ├── application dependencies
  ├── language runtime
  ├── operating-system packages
  ├── copied configuration and files
  └── image user and startup metadata
```

The scan should refer to the image digest rather than a mutable label. A later rebuild or tag move creates another object that needs its own result.

The scan belongs after the image exists because source analysis cannot see every file added by the build. Production images can reduce attack surface by retaining only the application, runtime, and required libraries. Compilers, Git, SSH, debuggers, package managers, and unused utilities can stay in a separate build stage instead of becoming extra vulnerabilities and attack primitives in production.

No scanner proves security. Each answers a bounded question at one layer. The pipeline combines their evidence with identity, artifact integrity, policy, review, and runtime controls.

## How Do SBOMs, Digests, Signatures, and Provenance Protect Artifacts?
<!-- section-summary: Inventory explains artifact contents, digests identify exact bytes, signatures authenticate approval, and provenance records the trusted build path. -->

When a new vulnerability appears in `libxyz 4.2`, a team needs to know which production artifacts contain it. Searching repositories is slow and may miss packages added during builds. A **Software Bill of Materials**, or **SBOM**, is a machine-readable component inventory associated with the release artifact.

An SBOM can record component names, versions, suppliers, identifiers, licenses, hashes, and dependency relationships. It acts like an ingredient label for software. During an incident, the team can query inventory for affected artifacts instead of asking every team to inspect its source manually.

```text
checkout-service artifact
├── Node 24.x
├── web framework 5.x
├── database driver 8.x
├── library-a 2.7
└── library-b 4.1
```

When an advisory names library-b `4.1`, inventory can identify the affected release objects and then the environments running them. The SBOM has operational value only if it remains associated with deployment records and can be queried during response.

The inventory should describe the released object. A repository may declare one hundred packages while only forty ship, or a build may add libraries absent from the top-level manifest. The strongest relationship is:

```text
artifact digest X ↔ SBOM describing X
```

Inventory does not establish integrity. A human-friendly tag such as `checkout:v9` can be moved or overwritten. A cryptographic **digest** identifies the bytes. Change one bit and the digest changes. It answers, “Is this exactly the same content?”

A digest does not answer who produced or approved the bytes. A trusted build identity can sign the artifact digest or produce an authenticated attestation. Deployment verifies the signature before accepting the object:

```text
artifact digest
      ↓ signature verification
trusted signer? ── no → reject
      │ yes
      ↓
continue policy evaluation
```

This turns “developers should use trusted artifacts” into a machine-enforced condition that untrusted bytes cannot satisfy merely by adopting a familiar tag.

The private signing authority must itself be protected. Modern systems can use a short-lived build identity to create an attestation instead of placing a long-lived signing key on every runner. In either design, the verifier needs a policy describing which signer or build identity is trusted for this artifact and environment.

**Provenance** records where the artifact came from: repository, commit, workflow, builder identity, inputs, trigger, and build time. It connects a reviewed source state to an approved build path and exact artifact digest.

```text
source commit
     ↓ approved workflow
known builder and inputs
     ↓
artifact digest
     ↓ verified policy
production
```

Provenance protects against a build-path attack that source review alone cannot catch. An attacker may upload a malicious image directly to the registry without changing reviewed code. A production policy that requires provenance from the approved mainline workflow rejects that manual object.

Suppose trusted CI produces digest `sha256:7fa...` and records source `abc123`, workflow `release`, and builder identity `trusted-ci`. An attacker later pushes malware under the same `payments:v53` tag. The malicious image has a different digest, no accepted signature, and no provenance from the approved builder. A verifier checking those properties rejects it even though the tag looks familiar.

Security evidence should attach to immutable identity. “Image A passed” is weak if someone rebuilds image B from the same commit and production deploys B. A stronger record associates digest `sha256:abc...` with SAST, dependency policy, image scan, SBOM, signature, and provenance results.

The delivery system now has three graphs. The control graph orders jobs. The data graph moves source and artifacts. The evidence graph connects source and artifact identities to security results. Production can require that the artifact exists, its signature verifies, its provenance is trusted, and its applicable security policy passed.

## Why Are Runners and Pipeline Extensions Trust Boundaries?
<!-- section-summary: Runners execute arbitrary build code, and third-party actions or plugins extend that code with the permissions and network reach of the job. -->

A runner executes commands such as package installation, tests, and image builds. Those operations can run arbitrary source and dependency code. If the same job holds a production token, cloud administrator role, or signing authority, malicious code can try to steal or misuse it.

Untrusted code and trusted secrets must not casually meet. A public pull request can add a line that prints an environment variable or sends it over the network. If forked code receives a production secret, the pipeline converts a review request into credential theft.

Separate trust levels instead:

```text
untrusted validation
  ├── compile
  ├── lint
  └── test
       │ no production credentials
       ↓ after review and merge
protected mainline
       ↓
trusted release job
       │ scoped temporary authority
       ↓
production
```

Hosted ephemeral runners often begin fresh and disappear after a job. A long-lived self-hosted runner can accumulate files, modified tools, Docker layers, credentials, processes, or malicious persistence. If Job A replaces `/usr/local/bin/npm`, Job B may execute the altered binary. Clean execution supports both security and reproducibility by reducing hidden cross-job state.

Persistent state can cross trust levels. An untrusted validation job can leave a modified executable or background process, and a later privileged release job can consume it. Separate pools are safer than relying only on cleanup: public pull-request validation on disposable workers, trusted mainline builds on controlled workers, and protected deployment on runners whose network and credentials match that narrow purpose.

Self-hosting may be necessary for private networks or special hardware. It also transfers responsibility for isolation, patching, cleanup, network access, credentials, and control over which identities may schedule jobs. A runner's network path to an internal database or Kubernetes control plane is itself a privilege, even without an explicit API token.

Third-party actions and plugins are pipeline dependencies. A workflow extension executes code in the delivery environment with the permissions available to that job. Review who maintains it, which exact version runs, whether it can change unexpectedly, and which credentials or files it can access.

This includes checkout actions, package helpers, test reporters, registry login steps, Jenkins plugins, and any remote installer executed by a shell command. Application dependency review that ignores delivery extensions leaves executable code outside the inventory of trust.

Using `latest` makes the same workflow definition execute different upstream code over time. Version pinning—and an immutable revision for sensitive automation where appropriate—reduces uncontrolled movement. Pinning does not prove a dependency is safe, but it makes changes explicit and reviewable.

The pipeline dependency tree therefore includes application packages, build tools, base images, actions, plugins, and runner images. Supply-chain security covers every one because each can influence the bytes or evidence the pipeline produces.

## How Should Security Gates and Exceptions Be Designed?
<!-- section-summary: A security gate enforces an actual risk policy, while explicit owned exceptions prevent noise from freezing legitimate delivery. -->

Scanner output needs a decision policy: continue, block, require review, or record remediation. “Fail when warning count is greater than zero” appears strict but collapses under false positives and historical noise. Developers eventually learn to bypass a gate that treats every finding as equally urgent.

A risk-aware policy can distinguish:

- a committed production private key, which blocks immediately and triggers rotation;
- an actively exploitable critical dependency on a reachable path, which blocks;
- a medium issue with a compensating control, which receives an owner and deadline;
- a license requiring legal review, which pauses for the appropriate approval;
- an informational code-quality finding, which reports without blocking release.

One practical policy shape is:

| Finding | Default response |
|---|---|
| Real production credential in a commit | Block, rotate, and investigate exposure |
| Exploitable critical dependency on a reachable production path | Block and update or mitigate |
| High-confidence critical source finding | Block for evaluation and repair |
| Missing signature or trusted provenance on a production artifact | Reject deployment |
| Medium issue with a documented compensating control | Track with owner and expiry |
| Informational or low-confidence result | Report and tune without freezing delivery |

Triage asks whether the finding is real, relevant, reachable, severe in this context, fixable now, and mitigated elsewhere. Possible outcomes include immediate repair, release blocking, temporary acceptance, compensating mitigation, scheduled remediation, or a documented false positive.

The decision should preserve evidence. “Ignore” loses the reason. A triage record can state that the vulnerable function is unreachable, the package is development-only, network policy blocks the affected endpoint, or an upgrade is unavailable. Each claim can later be revisited when the application, exposure, or upstream package changes.

Exceptions must be explicit and accountable. A temporary acceptance should name the finding, reason, owner, scope, compensating control, creation date, and expiration. Without expiry, “temporary” can survive for years after its original assumptions change.

A blocking gate should represent risk the organization has decided it cannot accept, not a desire to make a dashboard entirely green. If thirteen unrelated old medium findings prevent an emergency fix for a critical production vulnerability, the security process can make the system less secure. Existing debt and new regressions often need separate policies so new work cannot worsen the baseline while teams remediate old issues deliberately.

Checks also belong at different points. Pull requests can run secret scanning, SAST, dependency checks, and workflow policy while the relevant source is fresh. The build produces the object needed for an SBOM, image scan, signature, and provenance. Staging can support runtime or dynamic security validation. Placement follows data availability and feedback cost.

```text
pull request
  ├── secret scan
  ├── SAST
  ├── dependency and license policy
  └── workflow review
        ↓ merge
trusted build
  ├── final image scan
  ├── artifact SBOM
  ├── signature or attestation
  └── provenance
        ↓ staging
runtime validation
        ↓ production policy verification
```

Image scanning cannot inspect exact final contents before the image exists. An artifact signature cannot exist before there is a digest to sign. Placement follows the object each control evaluates.

Fast, focused checks belong near the change. Longer analysis can run before release or on a schedule if its feedback still reaches an owned queue. A slow or noisy gate without an operating process is a queue of alerts, not a security control.

Security should preserve delivery of legitimate changes. Well-designed automation can return consistent feedback in minutes, improving both speed and security compared with a multi-day manual review that repeats the same technical checklist.

This is why tuning belongs to the operating model. Security engineers should review false positives, stale rules, scan duration, bypass frequency, and the age of accepted findings. Developers need a direct path from a failed result to the affected source, component, or artifact and the policy that made it blocking. A gate that is fast, explainable, and consistently enforced is harder to dismiss than one that behaves like an unpredictable external veto.

Delivery urgency does not erase policy, but policy can include an emergency path. A critical production fix may use an explicit, audited exception approved by the right owner, limited to the affected artifact and environment, and expiring immediately after the release. Silent disabling of the scanner creates an unknown gap; a bounded exception creates a decision the organization can inspect and revisit.

## How Do Review, Audit, Detection, and Recovery Protect the Chain?
<!-- section-summary: Protected definitions, separated duties, traceable decisions, monitoring, and rehearsed recovery address failures that preventive controls miss. -->

Protecting application code while allowing unrestricted changes to the release workflow leaves a bypass. A person could replace test execution with a no-op, exfiltrate secrets, or deploy directly. Protected branches, required review, and ownership rules are especially valuable for files controlling builds, permissions, credentials, signing, and production deployment.

Sensitive systems can separate duties so one actor cannot change code, approve it, alter the pipeline, sign the result, and deploy production alone:

```text
developer proposes
reviewer approves
CI identity builds
release identity signs
deployment system verifies
production gate authorizes
```

This reduces the authority of any single compromised account. The exact divisions should match the system's risk without turning ordinary delivery into ceremony that people evade.

Ownership rules can give delivery files additional reviewers. A release workflow, deployment script, base image definition, or signing configuration may require approval from the team that understands its production impact. Required checks should prevent a workflow change from disabling the very checks that protect its merge.

Automation creates audit evidence. After an incident, the team should answer what artifact ran, when it was deployed, which source and workflow created it, which identity approved it, which digest was used, and which security results applied. Immutable release records and provenance make those answers queryable.

Prevention will never be perfect, so monitor for unexpected workflow changes, newly privileged runners, unusual secret access, unrecognized artifact publication, anomalous production deployment, verification failure, or security-gate bypass. Pipeline security follows **prevent, detect, and recover**, rather than assuming prevention can eliminate all malicious activity.

If a malicious artifact reaches production, responders may need to stop promotion, identify every affected environment, revoke or rotate credentials, restore or replace the artifact, inspect provenance, query SBOM data, and repair the trusted build path. Digests, inventory, logs, and provenance provide incident-response value in addition to their preventive value.

Response begins by bounding identity. Which digest is running, which release record promoted it, and which environments received it? Provenance identifies the expected source and builder; verification logs show whether a control failed or was bypassed. The team can then distinguish a source compromise, build compromise, registry replacement, credential theft, or deployment-policy failure.

The same logic applies to exceptions. Audit which exception allowed a finding through, whether its scope matched the release, who owned it, and whether its assumptions remain true. Expiration brings the decision back for review instead of silently weakening policy forever.

The chain should be traceable in both directions: developer intent to production during delivery, and production artifact back to source and evidence during investigation.

## How Does a Complete Secure Delivery Path Work?
<!-- section-summary: Secure delivery increases trust and authority gradually while attaching verifiable evidence to one immutable artifact. -->

Suppose a developer changes a payment service in commit `abc123`. The pull request runs secret scanning, SAST, dependency vulnerability analysis, and license policy. A reviewer inspects both application and workflow changes. The commit enters protected `main` only after required results pass.

A fresh runner receives source read access and permission to publish a release artifact, but no production administrator credential. Locked dependencies and reviewed build tools produce image digest `sha256:7fa...`.

The builder is powerful enough to create the candidate but not to deploy it. The release identity is powerful enough to sign or attest the result but only through the approved workflow. The deployment identity can modify the named production service for a brief period but cannot rewrite repository history or publish unrelated packages.

The artifact stage scans the actual image, generates an SBOM associated with its digest, records provenance linking the repository, commit, approved workflow, and builder, then signs or attests the digest through a trusted build identity.

Production does not accept a familiar tag merely because it exists. The deployment policy verifies exact digest identity, signature, provenance from the approved mainline workflow, and the required security policy evidence. Only then does a narrowly scoped temporary deployment identity receive permission to place that artifact into the environment.

If an attacker uploads malware under the same human-readable tag, the bytes produce another digest and lack the trusted signature and provenance. Verification rejects the object before production.

The mature trust chain is:

```text
developer identity
      ↓ reviewed change
protected mainline
      ↓ trusted workflow definition
isolated runner + locked inputs
      ↓ verified build
artifact digest
      ├── SBOM
      ├── scan evidence
      ├── signature
      └── provenance
              ↓ deployment verification
scoped environment authority
              ↓
production
```

At every boundary ask what is trusted, why it is trusted, and whether the system can verify that reason. Avoid **ambient authority**, where every workflow can see every secret, every runner reaches production, every developer can change deployment, and every registry object is deployable. Prefer a specific identity, permission, artifact, environment, and time.

A useful audit follows the questions in order:

```text
Who proposed the change?
Which review accepted it?
Which dependencies and tools entered the build?
Which runner and workflow produced the bytes?
Which digest identifies them?
Which inventory and findings apply?
Which identity signed or attested them?
Which production rule authorized this artifact here?
```

If the system cannot answer a question, that gap marks a place where trust rests on convention rather than verifiable evidence.

Trust and authority rise together. External input receives minimal privilege. Reviewed source can use the trusted builder. A verified artifact can approach deployment. A signed release that satisfies policy can receive narrowly controlled production access. It never gains high privilege before its inputs earn the required trust.

This proportional model also limits compromise impact. If malicious code runs during a low-trust pull-request test, it encounters disposable compute, public dependencies, and no production credential. If a release identity is stolen, its narrow scope and short lifetime restrict what it can change. If a registry object is replaced, digest and provenance verification stop the untrusted bytes. No single control is perfect; layered boundaries keep one failure from automatically becoming full production control.

The objective is not the largest collection of SAST, SCA, SBOM, image, signature, and dashboard products. It is preventing unauthorized or unacceptably risky software from reaching users while preserving the ability to deliver legitimate improvements. Every tool and gate should serve that outcome.

Secure CI/CD is ultimately an unbroken, verifiable chain from intent to running bytes. The system can explain who changed the source, which review occurred, what dependencies entered, who built it, on which trusted path, which artifact resulted, which evidence applies, whether it was altered, why it is authorized here, and how production verified those claims.

The word “unbroken” does not mean every link uses the same tool. It means every handoff preserves identity and an enforceable reason for trust. Source review hands a named commit to a trusted build; the build hands a digest and evidence to deployment; deployment hands a verified digest to the environment; runtime records let responders trace that digest back again. A gap at any handoff invites an unreviewed rebuild, mutable tag, privileged manual upload, or undocumented exception to replace the chain.

## Check Your Answers

:::expand[Why Is the Delivery Pipeline Part of the Production Security Boundary?]{kind="recap"}
The pipeline creates and promotes production software. Compromising source, workflows, credentials, runners, or artifacts can therefore control production without attacking a server directly.
:::

:::expand[How Should Pipelines Handle Secrets and Credentials?]{kind="recap"}
Keep secret material outside source, rotate real leaks, prefer short-lived workload identity, and restrict API, filesystem, network, and host authority to each job's task.
:::

:::expand[What Should Source, Dependency, and Image Scanning Establish?]{kind="recap"}
Each scanner supplies bounded evidence about a different layer. Findings require contextual risk evaluation and never prove that the complete application is secure.
:::

:::expand[How Do SBOMs, Digests, Signatures, and Provenance Protect Artifacts?]{kind="recap"}
The SBOM inventories contents, the digest identifies bytes, a signature authenticates trusted approval, and provenance links the object to its source and approved build path.
:::

:::expand[Why Are Runners and Pipeline Extensions Trust Boundaries?]{kind="recap"}
Runners and third-party extensions execute arbitrary code with the job's credentials, files, and network access. Isolation, cleanup, pinning, and trust-level separation constrain that power.
:::

:::expand[How Should Security Gates and Exceptions Be Designed?]{kind="recap"}
Gates should enforce unacceptable-risk policy. Lower risks need owned remediation, and any temporary exception needs a reason, scope, control, owner, and expiration.
:::

:::expand[How Do Review, Audit, Detection, and Recovery Protect the Chain?]{kind="recap"}
Protected definitions and separated duties prevent easy bypasses, audit records explain decisions, monitoring detects abnormal behavior, and recovery responds when prevention fails.
:::

:::expand[How Does a Complete Secure Delivery Path Work?]{kind="recap"}
Trust increases from reviewed source to isolated build, identified artifact, attached evidence, verified deployment policy, and narrowly scoped production authority.
:::

## References

- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Describes secret detection and push protection concepts.
- [GitHub OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Explains exchanging workflow identity for short-lived credentials.
- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) - Documents narrowing token permissions at workflow and job scope.
- [GitHub code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning) - Describes CodeQL, SARIF, and pull-request security feedback.
- [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review) - Explains dependency diffs and vulnerability policy on pull requests.
- [Trivy container image scanning](https://trivy.dev/docs/latest/target/container_image/) - Documents image vulnerability, configuration, secret, and license analysis.
- [CycloneDX SBOM capability](https://cyclonedx.org/capabilities/sbom/) - Describes component inventory and dependency relationships.
- [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) - Defines provenance connecting artifacts with builders and build definitions.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - Explains signed provenance and SBOM association.
- [Sigstore Cosign container signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/) - Documents signing and verifying container identities.
- [OWASP Top 10 CI/CD Security Risks](https://owasp.org/www-project-top-10-ci-cd-security-risks/) - Catalogues common delivery-chain threats.
- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - Provides secure development practices for reducing software risk.
