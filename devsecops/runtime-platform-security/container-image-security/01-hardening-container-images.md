---
title: "Hardening Container Images"
description: "Build smaller, safer container images with trusted bases, pinned versions, non-root users, clean secrets, and read-only-friendly layouts."
overview: "Start with a container image as the shipping box for payments-api. Then build the box step by step: choose a trusted minimal base, pin versions and digests, separate build and runtime stages, reduce packages, run as a non-root user, set file ownership, protect build secrets, design for read-only runtime, and inspect and scan before push."
tags: ["devsecops", "containers", "image-hardening", "docker"]
order: 1
id: article-devsecops-container-image-security-minimal-base-images
---

## Table of Contents

1. [Why Does Image Hardening Start with Attack Surface?](#why-does-image-hardening-start-with-attack-surface)
2. [How Do You Choose a Trusted and Repeatable Base?](#how-do-you-choose-a-trusted-and-repeatable-base)
3. [Why Should Build and Runtime Environments Be Separate?](#why-should-build-and-runtime-environments-be-separate)
4. [How Do Layers, Files, and Secrets Change Exposure?](#how-do-layers-files-and-secrets-change-exposure)
5. [How Do Non-root and Read-only Design Limit Compromise?](#how-do-non-root-and-read-only-design-limit-compromise)
6. [What Should You Inspect and Scan Before Release?](#what-should-you-inspect-and-scan-before-release)
7. [How Do Immutable Images Change Maintenance and Response?](#how-do-immutable-images-change-maintenance-and-response)
8. [What Does a Complete Hardened Image Workflow Look Like?](#what-does-a-complete-hardened-image-workflow-look-like)
9. [Check Your Answers](#check-your-answers)

A container image is a packaged filesystem plus metadata that tells a container runtime what to execute. The filesystem can contain an application binary, language runtime, shared libraries, operating-system packages, configuration defaults, user and group records, and supporting files. The metadata supplies details such as the entrypoint, command, working directory, declared user, and environment defaults.

Starting a container turns that package into a process. That creates two connected security questions:

1. What software and data are present in the package?
2. What authority will the resulting process receive?

Image hardening concentrates on the first question and establishes useful defaults for the second. Its purpose is not merely to produce a small download. It is to remove unnecessary software, privilege, secrets, data, and uncontrolled variation from the artifact that will enter production.

Suppose an API needs only a Node.js runtime, its compiled application, production dependencies, and two native libraries. A convenient development image might additionally contain Bash, Git, cURL, wget, Python, compilers, package managers, SSH clients, debuggers, and unrelated operating-system packages. Those programs do not necessarily create the original application vulnerability, but they enlarge the set of tools available after exploitation.

Keep these questions in view as you work through the lesson:

1. **Why Does Image Hardening Start with Attack Surface?**
2. **How Do You Choose a Trusted and Repeatable Base?**
3. **Why Should Build and Runtime Environments Be Separate?**
4. **How Do Layers, Files, and Secrets Change Exposure?**
5. **How Do Non-root and Read-only Design Limit Compromise?**
6. **What Should You Inspect and Scan Before Release?**
7. **How Do Immutable Images Change Maintenance and Response?**
8. **What Does a Complete Hardened Image Workflow Look Like?**

## Why Does Image Hardening Start with Attack Surface?
<!-- section-summary: An image packages a filesystem and execution metadata, so every unnecessary program, privilege, secret, and variable input expands what defenders must trust and what an attacker can use. -->

The post-compromise difference matters:

```text
application flaw
  -> attacker gains code execution
  -> available programs and credentials determine the next moves
  -> image and runtime controls determine the blast radius
```

In a broad image, the attacker may discover the network, download another payload, compile code, unpack archives, inspect credentials, or modify startup files with tools already installed. In a narrow image, the application flaw remains serious, but many convenient follow-on actions disappear. Hardening therefore aims to reduce what a successful compromise can become.

This is the attack-surface principle: every component placed in the image becomes something the team may need to trust, inventory, patch, monitor, and defend. The application, base operating-system packages, language runtime, system libraries, package-manager output, certificates, configuration, and copied files all join the production trust boundary.

Image size can reveal accidental excess, but it is only a signal. One small vulnerable library can be more dangerous than a large harmless data file. A larger image can still have a carefully controlled dependency set, while a tiny unknown image can have weak provenance. Review contents and capabilities rather than treating megabytes as a security score.

![Image hardening path infographic showing payments-api moving through trusted base, pinned digest, multi-stage build, non-root user, clean secrets, and read-only readiness before the private registry](/content-assets/articles/article-devsecops-container-image-security-minimal-base-images/image-hardening-path.png)

The first practical step is to write down the minimum runtime contract. Name the executable, required libraries, certificates, configuration inputs, user identity, ports, read paths, and write paths. Anything outside that contract needs a reason to remain.

## How Do You Choose a Trusted and Repeatable Base?
<!-- section-summary: A useful base is maintained, understood, compatible, minimal for the workload, and identified precisely enough that the same build does not silently inherit different software. -->

The base image supplies the starting filesystem and frequently the language runtime. Choosing it is a supply-chain decision, not just a Dockerfile convenience. A trusted base has a known publisher, a maintenance and update path, an understandable package source, and enough documentation for the team to know what it contains.

“Minimal” means no more than the workload and its operations require. It does not mean selecting the smallest unfamiliar artifact on a registry. A randomly tiny image can create different risks: unknown origin, missing security updates, incompatible libraries, no reliable certificate store, or an emergency debugging path that the team has never tested. The goal is a deliberately small and supportable base.

Every dependency expands the trust boundary. An image based on a language runtime inherits the runtime, its operating-system layer, installed packages, certificate authorities, and build decisions of the publisher. Application packages add their own transitive dependency trees. Native extensions may bring compilers into the build and shared libraries into production. Hardening begins by making those inherited choices visible.

Repeatability is also a security property. If the same source revision produces a different artifact on Tuesday than it did on Monday, the team cannot cleanly answer what was reviewed, tested, or deployed. Mutable tags and unconstrained package ranges allow build inputs to move without a source change.

Pin the inputs that must repeat. Depending on the toolchain, that can include:

- a base-image version or, for exact identity, a digest;
- application dependency versions through a committed lockfile;
- operating-system package versions when reliable repositories and maintenance practices support it;
- toolchain and build-tool versions;
- external downloads by version and checksum.

For example, a versioned base is more controlled than a floating family name:

```dockerfile
FROM node:24-bookworm-slim
```

A digest adds exact content identity:

```dockerfile
FROM node:24-bookworm-slim@sha256:<reviewed-digest>
```

Tags remain useful human labels, but a digest states exactly which manifest the build consumed. The tradeoff is deliberate: a digest-pinned image will not silently receive a repaired base. That is good for reproducibility and creates a maintenance duty.

Pinning and updating solve different problems. Pinning makes change explicit; scheduled updates keep explicit inputs from becoming stale. A sound process discovers new base releases, reviews their provenance and changes, rebuilds the application, reruns tests and scans, and publishes a new immutable application image. “Pinned forever” converts stability into unpatched debt.

Dependency locks need the same treatment. A lockfile should enter the build before dependency installation so the package manager resolves the reviewed graph. A command intended for reproducible installation, such as `npm ci`, should fail rather than silently rewrite that graph. Updating the lockfile becomes a reviewable supply-chain event.

Trusted selection also includes architecture and runtime compatibility. The base must support the target CPU, system calls, native libraries, certificates, time-zone behavior, and language features. If the application requires a component, hiding that fact to make the image smaller only moves failure into production. Minimalism should remove unnecessary requirements, not deny real ones.

## Why Should Build and Runtime Environments Be Separate?
<!-- section-summary: Multi-stage builds let compilers, package managers, tests, and source exist in temporary build stages while the final runtime contains only production dependencies and executable output. -->

Building software and running software require different things. A build may need source code, compilers, header files, package managers, test frameworks, linters, code generators, and caches. A running service often needs only compiled output, production libraries, certificates, and a runtime.

Putting both sets into one image joins two trust domains. Development tools remain available to an attacker, source and test fixtures may be disclosed, and the patch surface grows. Multi-stage builds separate them.

Each `FROM` instruction begins a stage. Early stages can be broad because they exist to transform source into artifacts. The final stage starts from a clean runtime base and receives only selected outputs with `COPY --from=...`. Files not explicitly copied do not appear merely because they existed in the builder.

```text
source + compiler + tests + package manager
                  |
                  v
             build output
                  |
                  v
runtime base + production dependencies + selected output
```

![Builder versus runtime infographic showing build tools, tests, compilers, and cache staying in the builder stage while only runtime files move into the smaller payments-api runtime image](/content-assets/articles/article-devsecops-container-image-security-minimal-base-images/builder-vs-runtime.png)

The important principle is selective transfer. Do not copy the builder's whole filesystem into the final stage. Copy the compiled application, verified production dependencies, and specifically required runtime files. Broad operations such as `COPY . .` in the runtime stage can bring tests, local configuration, `.git`, editor settings, credentials, or build outputs that were never meant for production.

A `.dockerignore` helps narrow the build context before any stage begins. It should exclude version-control data, local environment files, dependency caches, test results, editor metadata, and credentials. This both limits accidental inclusion and reduces what the build service receives.

The following simplified Node.js pattern separates compilation, production dependency installation, and execution:

```dockerfile
FROM node:24-bookworm-slim AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps --chown=10001:10001 /app/node_modules/ ./node_modules/
COPY --from=build --chown=10001:10001 /src/dist ./dist
COPY --chown=10001:10001 package.json ./
USER 10001
CMD ["node", "dist/server.js"]
```

This is a pattern, not a universal Dockerfile. A compiled static binary may need no language runtime. A native program may require selected shared libraries. An interpreted application may need source files as runtime input. The invariant is that every item in the final stage exists for a stated runtime reason.

Remove package-manager caches and temporary material in the same layer where they are created. Installing packages in one layer and deleting caches in a later layer can leave their bytes in the earlier layer. Combine installation and cleanup when the package manager supports it, and avoid keeping package indexes that production will never use.

Development tools should not enter production merely for convenience. If operational diagnosis requires them, decide explicitly whether to use a separate diagnostic image or controlled ephemeral debugging process. Permanently shipping a general-purpose toolbox changes the post-compromise environment for every container instance.

## How Do Layers, Files, and Secrets Change Exposure?
<!-- section-summary: Container layers preserve build history, so narrow copies, correct cleanup, and secret-aware build mounts are necessary to keep sensitive or unnecessary material out of the final artifact. -->

Container images are assembled from content-addressed layers. A Dockerfile instruction often creates a new filesystem change set. Later layers can hide or delete a path from the final merged view, but the bytes may remain retrievable from an earlier layer.

That behavior explains a common secret failure:

```dockerfile
COPY .env /app/.env
RUN use-secret-from /app/.env
RUN rm /app/.env
```

The final directory listing may not show `.env`, yet the layer created by `COPY` can still contain it. The correct conclusion is not “delete secrets more carefully.” It is “do not copy secrets into an image layer.”

Build secrets and runtime secrets are different. A build secret may authenticate to a private package repository or source service while dependencies are fetched. A runtime secret may be a database password or API token used by the running process. Neither belongs baked into the published image.

Use the build system's secret-mount mechanism so the credential exists only for the relevant build step and is not committed to a layer. Keep build logs from printing it. Limit the secret's permissions and lifetime to the exact repository and operation required. Then verify the produced history and filesystem rather than assuming the mount was used correctly.

Runtime secrets should arrive when the container starts through the platform's secret mechanism. The image can contain the path or environment-variable name the application expects, but not the secret value. This lets the same immutable artifact move between environments while credentials remain environment-specific and independently rotatable.

Environment variables are not automatically safe just because they are metadata. A Dockerfile `ENV` or build argument can persist in image configuration, build history, cache records, or logs. Build arguments are especially unsuitable as a secret transport because the build system was not designed to make them confidential.

Review every `COPY` boundary. Prefer named files or output directories over the entire build context. Use ownership flags during copy rather than copying as root and recursively changing permissions later. Narrow copies reduce both the final contents and the chance that an unrelated local file silently alters the artifact.

Layer design also affects remediation. Shared base layers can make distribution efficient, but an application image still needs rebuilding when the base changes. Deleting an unsafe package in a later application layer does not rewrite the inherited base history. Select a repaired base and rebuild the final artifact.

Inspect build history for unexpected installation commands, URLs, environment values, and large layers. Inspect the final filesystem for shells, package managers, credentials, source, tests, caches, and temporary files. A successful build only proves that the builder produced an image, not that the image contains what security reviewers intended.

## How Do Non-root and Read-only Design Limit Compromise?
<!-- section-summary: A fixed non-root identity, precise ownership, separated writable data, and a read-only-friendly filesystem reduce what compromised application code can modify or turn into further privilege. -->

Containers provide isolation mechanisms, but a process is still a Linux process using the host kernel. Root inside a container is not automatically identical to unrestricted host root, yet it begins with a broader authority model than most applications need. Runtime configuration mistakes, excessive capabilities, dangerous mounts, or kernel flaws make that distinction important.

Declare a fixed non-root user in the image. A numeric user and group work even when the runtime image has no account database entry:

```dockerfile
RUN mkdir -p /app /tmp/app && chown -R 10001:10001 /app /tmp/app
USER 10001:10001
```

Place `USER` near the end, after privileged installation and ownership setup. Later Dockerfile instructions run as the current user. That is useful because it exposes unexpected root requirements during the build, but it can also break installation if changed too early without a plan.

Do not return to root simply to silence permission errors. A failure to write is information about the application's filesystem contract. Determine which paths actually need mutation, create those paths deliberately, and grant the runtime identity only the required access.

Avoid permission shortcuts such as world-writable application directories or set-user-ID utilities. They can effectively recreate broad authority. Ownership should be narrow enough that the application cannot overwrite its executable, dependency tree, entrypoint, or static configuration.

Separate executable code from writable data:

```text
/app/bin and /app/lib     read-only application material
/app/config               read-only defaults
/tmp/app                  temporary writable data
/var/lib/app              persistent data only if required
```

This separation supports a read-only root filesystem at runtime. The image remains the software record; explicitly mounted paths provide temporary or persistent storage. An attacker who controls the process has fewer places to install a modified binary, replace a library, alter startup files, or leave durable tools.

Read-only containers also reveal hidden application assumptions. An application might write logs beside its executable, create a cache under its package directory, place a PID file in an undeclared location, or modify configuration at startup. Those patterns may work in a writable development container and fail under a read-only runtime.

Fix each assumption according to intent. Send logs to standard output or a designated writable sink. Mount an ephemeral directory for cache or temporary files. Provide a volume for genuine durable state. Generate configuration outside the image or into a bounded writable location. The goal is not to make all writes impossible; it is to make every write destination explicit.

Non-root and read-only settings change an attack chain in different ways. Non-root limits the starting identity. Correct ownership prevents that identity from altering trusted code. A read-only root prevents filesystem persistence outside declared mounts. Runtime capability, syscall, network, and resource controls add further boundaries, but they belong to runtime hardening rather than image contents alone.

A hardened image makes those runtime controls easier. It already declares a non-root user, does not require package installation during startup, keeps mutable paths separate, and avoids privileged ports or device access. The platform can then enforce a strong baseline without breaking an image designed around root and a writable filesystem.

## What Should You Inspect and Scan Before Release?
<!-- section-summary: Inspect and scan the final immutable image—not just source or an intermediate stage—then interpret findings using contents, exploitability, ownership, and available remediation. -->

Scan the artifact that will actually run. Source dependency checks are useful, but the final image may include base packages, native libraries, language packages copied from another stage, certificates, and accidental files that source analysis does not represent. Scanning an intermediate builder can also report tools that never ship while missing mistakes in the final stage.

A pre-push inspection should answer:

- Which base and digest did the final stage use?
- Which operating-system and language packages remain?
- Which user and command are declared?
- Does the filesystem contain shells, package managers, source, tests, caches, or credentials unexpectedly?
- Can the container start as the declared non-root user?
- Which paths must be writable?
- Does it operate with a read-only root when expected?
- What does the vulnerability scanner report for this exact image digest?

Run the image locally using production-like controls. Confirm that startup, health checks, normal requests, shutdown, logging, certificate access, DNS, and temporary writes work. A hardening control that immediately forces operators to re-enable root or broad write access during deployment has not been integrated successfully.

Vulnerability scanning is not binary truth. A database can gain new findings after the image is built even though the artifact digest is unchanged. Package detection can miss statically linked or manually copied software. A reported vulnerable package may be present but unreachable in the running application. Severity, exploitability, exposure, available fixes, and ownership are separate inputs to a risk decision.

Do not use that uncertainty as a reason to ignore results. Record the image digest, scanner and database state, package location, finding, decision, owner, and remediation or bounded exception. Rebuild rather than modifying a running container when a base or dependency needs repair.

Inspection should include negative tests. Attempt to run as an arbitrary non-root user if the platform will assign one. Try writing outside declared paths. Confirm build credentials are absent from environment metadata, history, and files. Check that omitted development commands are genuinely unavailable. These tests verify security properties rather than only application success.

![Pre-push image checklist infographic with base reviewed, secrets clean, runs non-root, writable paths known, scan passes, and ready for registry checks around payments-api](/content-assets/articles/article-devsecops-container-image-security-minimal-base-images/pre-push-image-checklist.png)

Image hardening and runtime hardening should remain distinct in the review. The image controls shipped software, default user, ownership, and filesystem layout. Runtime policy controls capabilities, syscall filters, mandatory access control, mounts, resources, network access, and stronger sandboxes. A good artifact supports those restrictions, but an image cannot enforce every property of the environment in which it runs.

## How Do Immutable Images Change Maintenance and Response?
<!-- section-summary: Treat images as replaceable immutable release artifacts: rebuild for every repair, preserve digest identity, and reason about compromise across build, storage, and runtime boundaries. -->

A production image should not be a long-lived pet. Do not start a container, install a package inside it, edit a configuration file, and treat that mutated instance as the new release. Those changes are difficult to reproduce, review, scan, and roll back.

Instead, change the source or build inputs, produce a new image, test it, scan it, and deploy its immutable digest. The old digest remains a record of exactly what ran. This pattern makes incident response more deterministic because responders can identify affected artifacts rather than guessing which instances were manually changed.

Immutability does not mean software never changes. It means change creates a new identified artifact. A repaired base, upgraded dependency, configuration default, ownership fix, or removed tool all produce a new digest. Promotion should move the already-tested digest between environments rather than rebuild source separately for staging and production.

Threat-model the image across its lifecycle:

1. **Before build:** source, base references, dependency locks, and external downloads can be changed.
2. **During build:** the runner, build tool, network, caches, and credentials can influence output.
3. **At rest:** registry permissions, mutable tags, retention, signing, and metadata determine whether the stored artifact can be replaced or misidentified.
4. **At runtime:** user identity, filesystem writes, secrets, network, kernel controls, and resources determine what compromise can reach.

Hardening the Dockerfile addresses only part of that chain, but it creates several strong invariants. Production contains only declared runtime material. Build credentials are not present in the result. The default identity is not root. Trusted code is not writable by that identity. Required mutable paths are known. The artifact is inspected and scanned by digest.

Consider compromise in both a weak and hardened image. In the weak version, the attacker finds a shell and download tool, runs as root, rewrites the application, stores a payload in the root filesystem, and uses inherited credentials to reach other systems. In the hardened version, several of those steps fail or require a different exploit. No single control makes the application invulnerable, but each removed option reduces blast radius and improves detection.

Maintenance should continuously revisit the base and dependency graph. A previously clean digest can become associated with newly disclosed vulnerabilities. That does not change the bytes, but it changes what defenders know. Rebuild with repaired inputs when necessary, preserve the old digest and evidence for investigation, and update deployments through the normal controlled path.

## What Does a Complete Hardened Image Workflow Look Like?
<!-- section-summary: A complete workflow defines the runtime contract, controls every build input, creates a minimal non-root artifact, verifies negative properties, and publishes a new digest with evidence for every change. -->

For a payments API, begin with the runtime need rather than a convenient development environment:

```text
required:
  Node.js runtime
  compiled server
  production dependency graph
  CA certificates
  non-root identity 10001
  read-only application files
  writable /tmp/app

not required:
  source history
  test framework
  compiler
  Git client
  package manager at runtime
  build credentials
```

The local development loop is:

1. Choose and record a maintained base.
2. Build with committed dependency locks and narrow context.
3. Use separate build, dependency, and runtime stages.
4. Copy only production outputs with final ownership.
5. Run the image as its declared non-root identity.
6. Test a read-only root with only documented writable paths.
7. Inspect contents, configuration, and layer history.
8. Scan the exact final image and review findings.

The CI path repeats those properties in a controlled environment. It verifies base and dependency identities, blocks accidental secrets, builds without persistent credentials, runs application and negative hardening tests, produces the final artifact once, records its digest, creates inventory and scan evidence, and pushes only after required checks pass.

```text
reviewed source and locked inputs
  -> isolated multi-stage build
  -> minimal final filesystem
  -> fixed non-root identity and ownership
  -> secret and history inspection
  -> application plus read-only tests
  -> final-image scan
  -> immutable digest and evidence
  -> protected registry
```

The local and CI checklist should cover both contents and behavior:

- trusted, maintained, compatible base;
- explicit version or digest selection;
- locked application dependencies;
- reviewed external downloads and checksums;
- narrow build context and copy operations;
- no build tools, caches, source, or credentials in the final stage;
- no runtime secrets stored in the image;
- fixed non-root user and group;
- precise file ownership without world-writable shortcuts;
- executable material separated from writable data;
- successful read-only-root test;
- inspection and scanning of the exact published digest;
- recorded owner and remediation for findings;
- rebuild process for base and dependency updates.

Review the workflow again from an attacker's position. Before the build, a changed base reference or dependency lock can alter everything downstream. During the build, a compromised package source, overpowered credential, or poisoned cache can influence the result. After publication, weak registry controls can let a familiar tag point somewhere new. During execution, excessive privilege and writable code can turn one application flaw into persistence. The artifact review should preserve enough identity at every transition to determine where an unexpected component entered.

Also verify that the runtime stage does not repeat work that belongs in the build. Installing packages, downloading plugins, compiling native modules, or generating executable code when the container starts makes each instance a new unreviewed build. It also requires network access and write permission that the service may not otherwise need. Perform those transformations once in the controlled build, inspect their output, and start production from the resulting immutable filesystem.

Operational convenience should use a separate path. If responders need network or process tools, attach a short-lived diagnostic environment under explicit authorization instead of leaving the tools in every service image. If a rare migration requires broader filesystem access, run a separately reviewed job rather than granting the long-running API that authority. Removing an exceptional requirement from the normal container is often stronger than trying to constrain it forever.

Finally, treat hardening failures as design feedback. A non-root error identifies an undeclared ownership need. A read-only error identifies an undeclared write. A minimal-image error identifies a hidden runtime dependency. Resolve the need narrowly, update the runtime contract, and add a regression test so the next refactor does not silently restore broad permissions or packages.

The core mental model is:

```text
hardened image
  = necessary software
  + controlled and repeatable inputs
  + no embedded secrets
  + least-privileged defaults
  + explicit writable boundaries
  + verified final contents
```

An image built this way is not “secure forever.” It is a smaller, more explainable artifact whose identity and behavior can be connected to registry controls, deployment policy, and runtime isolation. That is the useful DevSecOps outcome: fewer hidden powers and a controlled way to create the next repaired image.

## Check Your Answers

:::expand[Why Does Image Hardening Start with Attack Surface?]{kind="recap"}
An image becomes a process, so unnecessary programs, files, privilege, secrets, and variable inputs expand both the production trust boundary and an attacker's options after compromise.
:::

:::expand[How Do You Choose a Trusted and Repeatable Base?]{kind="recap"}
Choose a maintained and understood base that is minimal for the real workload, identify inputs precisely, and pair pinning with a deliberate update-and-rebuild process.
:::

:::expand[Why Should Build and Runtime Environments Be Separate?]{kind="recap"}
Multi-stage builds keep compilers, tests, source, package managers, and caches in temporary stages while copying only justified runtime material into production.
:::

:::expand[How Do Layers, Files, and Secrets Change Exposure?]{kind="recap"}
Deleted files can remain in earlier layers, so narrow copy boundaries, same-layer cleanup, and secret mounts are required to keep sensitive or unnecessary material out of the artifact.
:::

:::expand[How Do Non-root and Read-only Design Limit Compromise?]{kind="recap"}
A fixed non-root identity, precise ownership, non-writable code, and declared write paths remove several persistence and privilege options from compromised application code.
:::

:::expand[What Should You Inspect and Scan Before Release?]{kind="recap"}
Inspect, exercise, and scan the exact final image by digest, then interpret findings with package location, exposure, exploitability, ownership, and remediation context.
:::

:::expand[How Do Immutable Images Change Maintenance and Response?]{kind="recap"}
Repairs create new digests instead of mutating running containers, which preserves release identity, makes promotion reproducible, and gives incidents an exact artifact record.
:::

:::expand[What Does a Complete Hardened Image Workflow Look Like?]{kind="recap"}
Define the runtime contract, control build inputs, produce a minimal non-root image, verify positive and negative behavior, scan it, and publish one immutable digest with evidence.
:::
