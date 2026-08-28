---
title: "Dependency and Package Risk"
description: "Learn how package identity, dependency graphs, lockfiles, immutable installation, namespace controls, update review, build isolation, and continuous inventory reduce software dependency risk."
overview: "Treat a package manager as a remote-code acquisition system. Trace direct, transitive, runtime, and build authority; make version resolution reproducible with lockfiles; review update pull requests as supplier changes; defend private namespaces and human package selection; enforce CI guardrails; contain build scripts and network; and balance patching with the risk of every new version."
tags: ["devsecops", "dependencies", "packages", "supply-chain"]
order: 1
id: article-devsecops-pipeline-security-dependency-scanning
---

## Table of Contents

1. [Why Is a Package Manager a Remote-Code Acquisition System?](#why-is-a-package-manager-a-remote-code-acquisition-system)
2. [How Do Dependency Graphs Expand Trust and Authority?](#how-do-dependency-graphs-expand-trust-and-authority)
3. [Why Do Lockfiles and Immutable Installation Matter?](#why-do-lockfiles-and-immutable-installation-matter)
4. [How Should a Dependency Update Pull Request Be Reviewed?](#how-should-a-dependency-update-pull-request-be-reviewed)
5. [How Do Namespace, Maintainer, and Package-Name Attacks Work?](#how-do-namespace-maintainer-and-package-name-attacks-work)
6. [How Do CI Guardrails and Continuous Inventory Reduce Risk?](#how-do-ci-guardrails-and-continuous-inventory-reduce-risk)
7. [How Do Build Isolation and Reachability Change Priority?](#how-do-build-isolation-and-reachability-change-priority)
8. [What Does a Secure Dependency Lifecycle Look Like?](#what-does-a-secure-dependency-lifecycle-look-like)
9. [Check Your Answers](#check-your-answers)
10. [References](#references)

An application rarely consists only of code written by its team. A package manager reads a manifest, resolves package names and versions, downloads archives from registries, verifies available integrity metadata, installs a graph, and may execute package scripts.

That makes it a remote-code acquisition system:

```text
package name and version rule
      -> resolver and registry
      -> publisher-controlled archive
      -> install or build execution
      -> runtime code inside the application
```

The security identity of a package is not merely its short name. It includes ecosystem, namespace or scope, registry, version, resolved artifact, integrity digest, publisher or maintainer control, and sometimes signing or provenance. `utils@1.4` from an internal registry and a public package with the same name are not the same supplier relationship.

The package manager can execute authority at several times. Installation hooks may run immediately in CI. Build plugins can read source and credentials. Runtime libraries can access application data and network. Command-line tools may execute only on developer or build machines but still alter the final output.

Keep these questions in view as you work through the lesson:

1. **Why Is a Package Manager a Remote-Code Acquisition System?**
2. **How Do Dependency Graphs Expand Trust and Authority?**
3. **Why Do Lockfiles and Immutable Installation Matter?**
4. **How Should a Dependency Update Pull Request Be Reviewed?**
5. **How Do Namespace, Maintainer, and Package-Name Attacks Work?**
6. **How Do CI Guardrails and Continuous Inventory Reduce Risk?**
7. **How Do Build Isolation and Reachability Change Priority?**
8. **What Does a Secure Dependency Lifecycle Look Like?**

## Why Is a Package Manager a Remote-Code Acquisition System?
<!-- section-summary: Installing a package selects code controlled by an external or internal publisher, downloads it from a registry, and may execute it during build and runtime. -->

Therefore “we do not import this package in production” does not automatically mean it is harmless. A build dependency can steal a publish token during installation or modify generated output. Runtime presence and build-time authority are separate risks.

A package archive can also contain unexpected binaries, configuration, generated code, or scripts. Review cannot stop at one exported function. The installed object and its lifecycle behavior are the relevant input.

Vulnerability scanning covers known defects associated with known versions. Dependency security also includes malicious publication, compromised maintainer accounts, namespace confusion, typosquatting, unexpected install scripts, mutable resolution, abandoned projects, and excessive dependency growth. A clean vulnerability feed does not make an untrustworthy package safe.

Treat every new dependency as onboarding a software supplier. The supplier gains some combination of build, source, runtime, data, network, and release influence. The team should know why that trust is necessary and how it will be maintained or removed.

Package identity should be verified before the first install, when the name is most likely to be chosen from search results, documentation, or a copied command. Confirm the official project repository links to the expected registry package and that the registry links back consistently. Check namespace ownership and release history rather than trusting a familiar-looking name.

The registry is part of the acquisition boundary. It authenticates publishers, stores archives and metadata, serves resolver requests, and may expose signatures or provenance. Registry account compromise can publish malicious code under the correct name, so multifactor authentication, protected publishing automation, short-lived credentials, and narrow namespace access matter.

Package managers also translate metadata into execution. A lifecycle script that runs automatically is more authoritative than a library function invoked only by one code path. Review whether scripts are necessary, whether CI can disable them during initial inspection, and whether the build can reproduce required outputs without granting every dependency shell access.

A dependency can affect security without running directly. It can modify generated source, compiler configuration, bundler resolution, or test outcomes. The review should trace how package-controlled output enters the release and whether a later trusted job assumes that output is safe.

## How Do Dependency Graphs Expand Trust and Authority?
<!-- section-summary: Direct dependencies bring transitive graphs, and the security importance of each node depends more on what code can do than how many edges separate it from the application. -->

A manifest shows direct dependencies. Installation expands them into a graph:

```text
application
  -> library A
       -> library B
       -> library C
            -> library D
```

The team deliberately selected A but may never have heard of D. D can still appear in the runtime artifact or execute during build.

Depth is not the same as risk. A deeply transitive parser reachable from Internet input may be critical. A direct package used only for a harmless compile-time transformation may have less runtime impact, though it still receives build authority. Ask what the component can access and influence.

The graph can contain several relationship types:

- Runtime dependencies shipped or loaded with the application.
- Development dependencies used for tests and local tooling.
- Build dependencies that generate or transform release output.
- Optional dependencies activated by platform or feature.
- Peer or plugin relationships loaded by a host framework.

These categories are useful but not perfect security boundaries. Test and build code runs in CI, where tokens and source may be sensitive. An optional package may be present in production even when its feature is off. The final artifact and executed build process reveal reality.

More dependencies create more trust relationships: more maintainers, registries, release processes, transitive graphs, update events, advisories, and potential namespace errors. Count alone does not determine risk, but unnecessary packages expand the surface without adding required capability.

Authority analysis should include installation and build. A package script can read environment variables, modify the workspace, contact the Internet, or publish output. If the build job also holds registry or cloud credentials, a dependency compromise can use them during the legitimate job without first stealing them for later.

Production images should contain less than build environments. Use multi-stage builds or equivalent packaging so compilers, package managers, test frameworks, and build-only dependencies do not ship into runtime. This reduces component inventory, attack surface, and future vulnerability response.

Dependency authority should be evaluated at each stage. During install, can it execute shell commands and reach the network? During build, can it read private source or alter binaries? At runtime, can it process attacker input, access customer data, or make outbound requests? The same package may have different consequences at every stage.

Graph review also reveals concentration. One small transitive utility may appear through hundreds of direct dependencies and across many services. Its compromise creates multiplicity even if its individual function is simple. Inventory should support reverse queries from package version to every artifact and deployment.

Optional and platform-specific branches deserve evidence. A developer on one operating system may not install the package used in the production Linux build. Generate and inspect the graph under the actual release platform rather than assuming a local lockfile view reveals every selected dependency.

Deduplicate carefully. Two packages may wrap the same underlying library, increasing versions and update work. Reducing redundant frameworks and utilities can shrink the number of suppliers and conflicting transitive versions without rewriting product features.

![Dependency graph review expands direct packages into transitive code and checks source, version, integrity, scripts, authority, and rollback](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/dependency-graph-review.png)

_Review the graph and the authority of its nodes; a package's distance from the manifest does not determine its consequence._

## Why Do Lockfiles and Immutable Installation Matter?
<!-- section-summary: Version ranges express allowed future choices, while a committed lockfile and frozen install preserve the exact resolved graph, sources, and integrity used for a release. -->

A manifest range such as `^1.4.0` does not identify one artifact. It allows a resolver to choose among future compatible versions under ecosystem rules. Two builds on different days can install different graphs even when source control is unchanged.

Uncertainty affects reproducibility and review. Tests may pass against version 1.4.2 while production later resolves 1.4.7. A compromised or broken transitive release can enter without a manifest diff.

A **lockfile** records the resolution: exact versions, transitive graph, source locations, and available integrity values. It turns a broad request into release evidence.

```text
manifest: what versions are allowed?
lockfile: what versions and artifacts were selected?
```

The lockfile should be committed and reviewed. A one-line manifest change can rewrite hundreds of lock entries. Those entries reveal added packages, source changes, version jumps, and integrity updates that are invisible in the manifest alone.

The lockfile is not self-enforcing. CI must use an immutable or frozen install mode that rejects disagreement instead of silently recalculating the graph. If the package manager rewrites the lockfile during the build, the reviewed evidence no longer controls installation.

Integrity hashes help detect archive modification relative to the lockfile. They do not establish that the selected package was trustworthy or that the registry served the correct package when the lock entry was first created. Review package identity and source before accepting a new integrity value.

Lockfile behavior differs across ecosystems and package-manager versions. Pin the toolchain, understand workspace or platform-specific sections, and ensure all released targets are represented. A lockfile produced by one tool version may be interpreted differently by another.

Treat unexpected lockfile changes as security-relevant. If a source URL moves from the internal registry to a public one, a transitive package appears, or install scripts are introduced, the reviewer needs an explanation.

The lockfile and an SBOM answer related but different questions. The lockfile controls or records dependency resolution for the build. The SBOM inventories components in a particular produced artifact. Build steps can add or remove software after installation, so both views are useful.

Resolution includes registry choice. A lock entry that records only name and version but not source may be insufficient to distinguish private and public packages. Where the ecosystem records resolved URLs or registries, enforce them. Where it does not, combine lockfile review with package-manager registry policy and network restrictions.

Lockfile integrity should be protected through ordinary source review. An attacker who can replace both package archive and reviewed integrity value can make checksum verification pass. The hash detects mismatch with the committed decision; branch protection and reviewer judgment protect that decision.

Do not regenerate the lockfile casually to remove merge conflicts. Resolution can select new versions throughout the graph, transforming a conflict cleanup into an unreviewed update. Re-run the graph summary and tests, and explain changes beyond the intended packages.

For monorepos and workspaces, make sure all manifests and shared lockfiles are covered by ownership and CI. A change in one workspace can alter resolution for another service. The released subgraph should still be identifiable by artifact.

## How Should a Dependency Update Pull Request Be Reviewed?
<!-- section-summary: An update PR changes supplier code, resolved graph, scripts, source, integrity, and possible runtime behavior, so automation should expose the change rather than replace human judgment. -->

A dependency update is a security event even when the manifest diff is one line. It can add hundreds of transitive packages, change maintainer-controlled code, introduce scripts, alter licensing, change runtime behavior, or fix known vulnerabilities.

Automation is valuable because it discovers releases and opens a pull request with version and advisory context. It should reduce search work, not make the trust decision invisible.

Review the proposed update across several dimensions:

- Is the package, namespace, and registry the intended one?
- What direct and transitive versions change?
- Which source URLs and integrity values change in the lockfile?
- Are install or build scripts added or modified?
- What do upstream release notes, advisories, and source diffs say?
- Did maintainership, ownership, or publishing behavior change?
- Which tests exercise the affected behavior?
- Can the team roll back precisely?

Do not review only the headline vulnerability. An update that fixes CVE X may also introduce unrelated behavior or a new transitive supplier. Conversely, delaying every update because change has risk leaves known vulnerabilities and unsupported code in place.

The dependency update PR should run frozen installation, ordinary tests, security tests, dependency review, license or policy checks, build, and artifact comparison where useful. High-authority build plugins deserve deeper scrutiny than a small runtime data library with a narrow interface.

Review the lockfile diff in graph terms. Identify packages added, removed, or moved between sources. A large mechanical diff can be summarized by tooling, but the summary should not hide new registry domains, lifecycle scripts, or unexpected major changes.

Treat bot identity as a proposer, not an approver. Protected branch rules and accountable owners should still govern sensitive manifests, lockfiles, registry configuration, and build plugins.

After merge, continuous scanning remains necessary. A package can become known vulnerable tomorrow even though its bytes and review did not change. The recorded graph and artifact inventory let the team reevaluate old releases against new knowledge.

Update review should assess behavior, not only successful tests. A compromised package may preserve the public API while adding credential collection or outbound traffic. For high-authority build dependencies, compare install scripts, new domains, published archive contents, and generated output. Run the update on an isolated low-secret runner first.

Major, minor, and patch labels are publisher statements about compatibility, not security guarantees. A malicious release can use any version number, and a legitimate patch can still change important behavior. Semantic-version policy helps manage compatibility but does not replace review.

Batch size affects evidence. Updating fifty unrelated packages at once reduces the ability to attribute a failure or suspicious behavior. Smaller coherent updates are easier to review and roll back, though automation can group tightly coupled ecosystems where independent movement is impractical.

Record why an update is urgent. Known exploitation, a reachable high-impact flaw, registry compromise, or maintainer warning may justify an expedited path. Preserve the same identity, graph, frozen install, test, and approval evidence even when the review window is shorter.

## How Do Namespace, Maintainer, and Package-Name Attacks Work?
<!-- section-summary: Package resolution and human selection depend on namespaces and publisher control, so private-name ownership, registry routing, typo defenses, and maintainer review are part of package identity. -->

Package names create a namespace problem. An organization may use a private package called `parcelpulse-auth`. If the package manager can also search a public registry where an attacker publishes the same name, resolver configuration or version preference may select the public package. This is dependency confusion.

Private names need explicit ownership boundaries. Use scoped namespaces where the ecosystem supports them, reserve critical names publicly when appropriate, and configure registry routing so private packages resolve only from the authorized internal source.

![Package source check joins manifest name, registry rule, lockfile URL, and allow or block decision](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/package-source-check.png)

_Package identity includes registry and namespace; the same short name from another source is a different trust relationship._

Verify the resolved source in the lockfile and CI. A developer configuration that uses the internal registry does not prove the production build did. Fail when a private namespace resolves to an unauthorized public location.

**Typosquatting** targets human selection. An attacker publishes a name visually or phonetically similar to a popular package and waits for a developer to mistype it. Review exact spelling, scope, publisher, repository, documentation links, and project history before first installation.

Popularity is evidence, not proof. Download counts, stars, and many dependents can indicate community scrutiny, but they can be manipulated and do not prevent maintainer compromise. A popular package can still publish a malicious version.

Maintainer trust is part of package trust. Accounts change, ownership transfers, release automation changes, and projects become abandoned. Watch for sudden publisher additions, unexpected release cadence, repository transfers, or packages revived after long inactivity.

Malicious packages change the threat model because there may be no vulnerability to discover. The code is behaving as designed by the attacker. Controls need to reduce the packages trusted, constrain their authority, and make new versions explicit.

Internal packages need the same discipline. A private registry and familiar team name do not guarantee safe publication. Protect maintainer accounts, release workflows, namespace write permissions, and provenance.

Dependency confusion can exploit version preference. If the internal registry contains version `1.2.0` and the public package offers malicious `9.9.9`, a resolver that searches both may choose the higher public version. Scoping and source mapping are stronger than hoping internal versions always win.

Names can also be abandoned and reclaimed depending on ecosystem policy. Removal or ownership transfer can change who controls future releases. Preserve exact versions and monitor project status rather than assuming the namespace owner is permanent.

Publisher diversity matters. A transitive graph may rely on many packages controlled by one maintainer account, or one package may have dozens of publishers. Both create different compromise paths. Review the identities that can release security-sensitive build plugins and runtime components.

Private package publication should use workload identity or narrowly scoped automation instead of broad personal tokens where supported. Publishing provenance can show that the expected release workflow produced the artifact, adding evidence beyond the registry username.

## How Do CI Guardrails and Continuous Inventory Reduce Risk?
<!-- section-summary: CI should enforce frozen resolution, approved sources, reviewed graph changes, script policy, vulnerability and license thresholds, and reproducible evidence while continuous inventory reevaluates released artifacts. -->

CI is the enforcement point because it turns repository intent into a release. Useful guardrails include:

- Reject manifest and lockfile disagreement.
- Use the pinned package-manager and frozen install command.
- Allow only approved registries and namespace routing.
- Detect newly added dependencies and transitive graph changes.
- Flag or block lifecycle scripts that violate policy.
- Run vulnerability, license, integrity, and policy checks.
- Produce the final artifact from the resolved graph.
- Generate an SBOM tied to the artifact digest.

Dependency review asks a change-focused question: what packages and risk does this pull request add or change? Vulnerability scanning asks which known advisories match the selected versions. Both are useful and neither proves that package code is benign.

Policy should distinguish historical debt from new risk. When onboarding an older repository, baseline existing findings into owned remediation work while preventing pull requests from adding unacceptable new dependencies or vulnerabilities.

Continuous scanning is required because vulnerability intelligence changes. Store the lockfile, SBOM, artifact digest, owner, environment, and deployment mapping so a new advisory can be joined against production inventory without rebuilding everything first.

An SBOM is an inventory, not the installation control. Generate it from the final artifact or build reality where possible. Keep it connected to provenance so responders know which process produced the document and which digest it describes.

CI should also preserve evidence for rejected changes. The graph diff, policy rule, source, and finding allow developers to understand the denial and reviewers to evaluate exceptions. A generic “dependency check failed” invites bypass.

Monitor guardrail health: repositories missing lockfiles, frozen install disabled, registry policy bypass, scanner coverage gaps, stale inventories, and dependencies without owners. A green result has value only if the expected controls ran on the released object.

Guardrails should validate negative conditions. Attempt to resolve a private package from a public registry in a test project and expect failure. Add a manifest change without updating the lockfile and expect frozen install to fail. Introduce an unapproved registry URL or lifecycle script and ensure policy reports the exact reason.

Use network policy to support resolver policy. If the trusted build should use only an internal proxy, prevent direct fallback to public registries. This also creates a controlled place for caching, malware checks, and outage management, though the proxy itself becomes trusted infrastructure.

Separate vulnerability intelligence from dependency inventory. The same artifact inventory can be joined with new feeds repeatedly. Rebuilding an artifact merely to learn whether it contains a package is slower and may produce different bytes; preserve the SBOM and resolved graph of the actual release.

Exceptions should name package, version, artifact or service scope, reason, owner, compensating control, and expiry. A global scanner ignore for a package name can hide later versions or services where the original reachability assumption does not hold.

## How Do Build Isolation and Reachability Change Priority?
<!-- section-summary: Build sandboxing limits what package code can do, while reachability and exploit context help prioritize known vulnerabilities without declaring present but unreachable code permanently safe. -->

Reduce what dependencies can access during installation and build. Pull-request jobs should have no publish token or production secret. Use ephemeral runners, read-heavy repository permission, separate caches, and narrow filesystems. A malicious package then has less authority even if executed.

Network access matters. Build scripts often download tools or contact registries, but unrestricted egress also enables exfiltration and mutable inputs. Use approved mirrors or proxies, block internal and production routes, and allow only destinations needed for the job where practical.

Separate build authority from publish and deploy authority. Produce an identified artifact in the build job, then pass it to a small publisher or deployment job. A dependency executed during build should not inherit registry write or cloud deployment merely because those operations happen later in the pipeline.

For known vulnerabilities, component presence is not the entire risk decision. Ask whether the affected version is present, the vulnerable code is included, the application reaches it, attacker input can reach the application path, exploit prerequisites hold, and meaningful impact follows.

Reachability can change priority. A vulnerable parser invoked by public input deserves different urgency from the same library installed but unused. It should not create complacency. Feature flags, code paths, configuration, and future releases can change; record assumptions and expiry.

Avoid the “latest is safest” fallacy. The newest release may remove known vulnerabilities but introduce malicious or unstable code. Avoid the opposite fallacy of never updating. Old versions accumulate known defects and lose support. Controlled, reviewed movement is the sustainable security strategy.

Production images should remove build-only packages and tools. Re-scan and regenerate evidence for the final artifact, because source dependency analysis can include packages not shipped and miss OS or files introduced by the image build.

Reachability evidence has confidence levels. Static analysis may show no call path, but dynamic workloads can use reflection, plugins, configuration, or rarely exercised features. Runtime observation can show that a path executed, but absence from a short trace does not prove impossibility. Use reachability to order work and state its assumptions.

Known exploitation changes priority sharply. A lower-severity flaw actively used against Internet-facing services can outrank a higher theoretical issue in a disabled internal feature. Combine advisory severity with exploitation intelligence, exposure, affected function, impact, and available controls.

Build sandboxing should keep package code from controlling the security evidence about itself. A dependency executed during build should not be able to overwrite scan reports, provenance, or SBOMs without detection. Generate core evidence through protected tooling and bind it to the final digest.

If a build requires network downloads beyond package resolution, record and pin them or move them into declared dependencies. Hidden `curl` operations inside scripts defeat lockfile reproducibility and expand the supply chain beyond the inventory.

## What Does a Secure Dependency Lifecycle Look Like?
<!-- section-summary: A secure lifecycle minimizes suppliers, resolves exact artifacts from approved sources, reviews every graph change, contains build authority, inventories final releases, monitors new knowledge, and removes obsolete trust. -->

A secure dependency update flow is:

```text
need for a package or update
      -> verify identity, source, maintainer, and purpose
      -> inspect manifest and resolved graph change
      -> update committed lockfile
      -> frozen CI install from approved registries
      -> tests, dependency review, policy, and build isolation
      -> final artifact and SBOM by digest
      -> controlled publish and deployment
      -> continuous advisory matching and ownership
```

Before adding a new supplier, ask whether standard language or platform functionality already solves the need, whether an existing approved dependency can serve it, and whether the package's capability justifies its trust cost.

For each accepted package, preserve ecosystem, namespace, registry, version, resolved integrity, direct or transitive path, runtime or build role, scripts, owner, and update method. This makes first installation and later incident response reviewable.

The trust chain explains many supply-chain attacks:

```text
developer trusts package name
  -> resolver trusts registry mapping
  -> registry trusts publisher identity
  -> build trusts package archive and scripts
  -> release trusts build output
  -> runtime trusts released artifact
```

Breaking one identity or authorization link can introduce code far downstream. Strong controls make every link explicit and reduce the authority it carries.


_Dependency security is a lifecycle of supplier choice, exact resolution, review, containment, evidence, monitoring, and removal._

The review unit is therefore the resolved dependency graph used by the release, not only the short manifest developers edit. That graph shows the selected versions, indirect packages, source locations, integrity records, and scripts that can affect the build.

Production habits matter: use frozen installs, review lockfiles, restrict registries, separate private namespaces, minimize lifecycle scripts, keep build jobs low authority, remove build tooling from runtime, generate digest-bound SBOMs, assign owners, scan continuously, and test precise rollback.

The deepest principle is that every dependency is executable trust. The goal is not zero third-party code; it is knowing exactly which code and supplier entered, limiting what it can do, controlling how it changes, and finding every release affected when new evidence appears.

The lifecycle also needs removal. When a package is no longer used, delete it from the manifest, update the lockfile, verify the resolved graph and final image no longer contain it, and remove related registry or publisher permissions. A dormant dependency still creates advisory noise and potential execution paths.

Practice the reverse query. Select a transitive package and version, find every lockfile and SBOM that names it, map those artifacts to environments, identify owners, and decide which build or runtime role the package had. If that search takes days, improve inventory before the next urgent advisory.

Finally, compare expected and actual release composition. The manifest expresses intention, the lockfile records resolution, the build log records installation, and the SBOM records the artifact. Mismatches reveal undeclared downloads, leftover packages, build scripts, or incomplete generation that deserve investigation.

Track dependency ownership over time. A package accepted for one feature should still have a team responsible for advisories, updates, replacement, and removal after the original author moves on. Record unsupported or end-of-life status as an actionable risk rather than waiting for the next CVE.

When the organization operates a package proxy, rehearse compromise and outage behavior. Builds should fail predictably instead of falling back to an unapproved public source, and responders should be able to identify every artifact built from a suspect cached package during the affected interval.

Retain the proxy logs and package digests needed for that investigation.

Test their retrieval periodically.

Repeat this review whenever dependency resolution, registry origin, or package ownership changes.

## Check Your Answers

:::expand[Why Is a Package Manager a Remote-Code Acquisition System?]{kind="recap"}
Package resolution downloads publisher-controlled code and may execute it during install, build, and runtime, so identity includes registry, version, artifact, and maintainer.
:::

:::expand[How Do Dependency Graphs Expand Trust and Authority?]{kind="recap"}
Direct choices pull transitive runtime and build code whose risk depends on reachable authority and impact, not graph depth alone.
:::

:::expand[Why Do Lockfiles and Immutable Installation Matter?]{kind="recap"}
The lockfile records exact resolution, and frozen CI ensures the reviewed graph rather than a newly computed graph enters the release.
:::

:::expand[How Should a Dependency Update Pull Request Be Reviewed?]{kind="recap"}
Treat updates as supplier-code changes and review package identity, graph, sources, integrity, scripts, maintainers, behavior, tests, and rollback.
:::

:::expand[How Do Namespace, Maintainer, and Package-Name Attacks Work?]{kind="recap"}
Protect private names and registry routing, verify exact package identity, resist typosquatting, and monitor maintainer and ownership changes.
:::

:::expand[How Do CI Guardrails and Continuous Inventory Reduce Risk?]{kind="recap"}
Enforce exact resolution and approved sources in CI, produce final-artifact inventory, and continuously join released versions with changing advisories.
:::

:::expand[How Do Build Isolation and Reachability Change Priority?]{kind="recap"}
Contain dependency execution with low-authority isolated builds and use reachability to prioritize, while preserving assumptions and continuous review.
:::

:::expand[What Does a Secure Dependency Lifecycle Look Like?]{kind="recap"}
Minimize suppliers, verify identity, lock exact artifacts, review graph changes, contain builds, inventory releases, monitor, and remove obsolete trust.
:::

## References

- [npm package-lock.json](https://docs.npmjs.com/cli/configuring-npm/package-lock-json) - Documents exact dependency-tree and integrity recording.
- [npm ci](https://docs.npmjs.com/cli/commands/npm-ci) - Documents frozen installation behavior against a lockfile.
- [GitHub dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review) - Describes change-focused dependency analysis.
- [GitHub Dependabot version updates](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates/about-dependabot-version-updates) - Documents automated update pull requests.
- [Package URL specification](https://github.com/package-url/purl-spec) - Defines canonical package coordinates including ecosystem and namespace.
- [OWASP Software Component Verification Standard](https://owasp.org/www-project-software-component-verification-standard/) - Provides software-component governance and verification guidance.
