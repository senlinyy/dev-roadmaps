---
title: "Dependency and Package Risk"
description: "Review third-party packages, registries, lockfiles, transitive dependencies, dependency confusion, and malicious package behavior."
overview: "Software delivery depends on packages from public and private registries. This article follows a dependency update through npm, Python, Maven, and an internal registry so you can see how package names, lockfiles, transitive dependencies, and review guardrails protect a release."
tags: ["devsecops", "dependencies", "package-registries", "lockfiles"]
order: 1
id: article-devsecops-pipeline-security-dependency-scanning
---

## Table of Contents

1. [The Review Scenario](#the-review-scenario)
2. [Package Names and Registries](#package-names-and-registries)
3. [Direct and Transitive Dependencies](#direct-and-transitive-dependencies)
4. [Lockfiles and Repeatable Installs](#lockfiles-and-repeatable-installs)
5. [Private Namespaces and Dependency Confusion](#private-namespaces-and-dependency-confusion)
6. [Malicious Packages and Maintainer Risk](#malicious-packages-and-maintainer-risk)
7. [Reviewing a Dependency Update](#reviewing-a-dependency-update)
8. [Guardrails in CI/CD](#guardrails-in-cicd)
9. [Putting It All Together](#putting-it-all-together)
10. [Next: SBOMs and Reachability](#next-sboms-and-reachability)

## The Review Scenario
<!-- section-summary: A dependency update looks small in a pull request, but it can change the code, registry, maintainer, and install behavior that enter production. -->

Imagine you are on the secure delivery team for a payments platform. The platform has a checkout web app written in Node.js, a risk scoring API written in Python, a settlement worker written in Java, and a few shared internal packages published to the company registry. A dependency update lands in a pull request from the automated update bot. At first glance, the change looks routine: a few version bumps, some lockfile churn, and a small test fix.

This is the moment where supply chain security shows up in daily engineering work. A **software dependency** is code your application imports instead of writing everything itself. In a Node app, a dependency might come from npm. In a Python service, it might come from PyPI. In a Java service, it might come from Maven Central or an internal Maven repository. A dependency can be direct, meaning your project names it directly, or transitive, meaning another package brings it in for you.

The pull request touches three parts of the payments platform. The checkout web app updates `@stripe/stripe-js` and `@acme/ui-tokens`. The Python risk API updates `requests` and `pydantic`. The Java settlement worker receives a transitive update to `jackson-databind` through a shared `payments-core` library. The private package `@acme/ui-tokens` should come only from the internal registry, because it contains shared design constants and release metadata that your company owns.

A junior engineer might ask, "If tests pass, why do we need a special dependency review?" That is a fair question. Tests tell you the application still behaves the way your test suite checks. They cannot tell you whether the package came from the expected registry, whether a transitive package gained an install script, whether the lockfile points to a new source, or whether an attacker published a public package with a name close to one of your private packages.

So this article follows that one pull request. We will start with package names and registries, because every dependency has to come from somewhere. Then we will look at transitive dependencies, lockfiles, private namespace rules, malicious packages, and the practical review steps a production team can use before a dependency update reaches a release pipeline.

## Package Names and Registries
<!-- section-summary: A package name only has meaning together with the registry that serves it, so review starts by checking both the name and the source. -->

A **package registry** is a server that stores published packages and metadata about those packages. npm has the npm public registry. Python packages usually come from PyPI. Java libraries often come from Maven Central. Many companies also run private registries through GitHub Packages, Artifactory, Nexus, AWS CodeArtifact, Azure Artifacts, or another internal package service.

The important beginner idea is this: a package name by itself leaves out half the story. The name `requests` means one thing when pip downloads it from PyPI. The name `@acme/ui-tokens` means something else when npm downloads it from the company registry. The registry answers the question, "Where did this package actually come from?"

For npm, a package can have a **scope**, which is the part before the slash in a name like `@acme/ui-tokens`. Scopes help group packages under an organization or namespace. A team can also associate a scope with a registry in `.npmrc`, so packages under that scope resolve from a specific place.

```ini
@acme:registry=https://npm.pkg.github.com
registry=https://registry.npmjs.org/
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

In this setup, `@acme/ui-tokens` should come from GitHub Packages, while normal public packages still come from the npm public registry. The secure delivery team cares about this file because a one-line registry change can redirect a private package name to a public registry or redirect public packages to a registry proxy controlled by someone else.

Python has the same kind of source question, even though the files look different. A Python service might install packages with pip from PyPI, from an internal index, or from both. A common configuration pattern uses `--index-url` for the primary index and `--extra-index-url` for an additional index:

```bash
python -m pip install \
  --index-url https://packages.acme.internal/simple \
  --extra-index-url https://pypi.org/simple \
  -r requirements.txt
```

This shape deserves careful review. pip warns that `--extra-index-url` can create dependency confusion risk because pip may choose a package with the same name from more than one location. In production, many teams avoid mixing private and public indexes in one resolver path for private names. They route private packages through a controlled internal index or proxy, and they make the internal package names unambiguous.

Maven has the same source idea through repositories in `pom.xml`, `settings.xml`, or repository manager configuration. A dependency name has a `groupId`, `artifactId`, and `version`. For example, `com.acme.payments:payments-core:2.4.1` should come from the company repository, while `com.fasterxml.jackson.core:jackson-databind` usually comes from Maven Central.

```xml
<dependency>
  <groupId>com.acme.payments</groupId>
  <artifactId>payments-core</artifactId>
  <version>2.4.1</version>
</dependency>
```

At this point in the pull request, the reviewer has one clear job: identify the names and sources. The npm package `@acme/ui-tokens` should use the `@acme` registry rule. The Python package `acme-risk-rules` should come from the internal package index. The Maven artifact `com.acme.payments:payments-core` should come from the internal repository. Public dependencies should come from trusted public registries or from an internal mirror that your team controls.

![Package source check infographic showing a dependency manifest, registry rule, lockfile resolved URL, and allow or block decision for private and public registries](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/package-source-check.png)

*A dependency name only becomes trustworthy when the manifest, registry rule, and lockfile all point to the source the team expected.*

## Direct and Transitive Dependencies
<!-- section-summary: A small direct version bump can pull in many transitive changes, so reviewers need to inspect the full dependency graph. -->

Once the team knows where packages come from, the next question is what actually enters the build. A **direct dependency** is a package your project declares by name. A **transitive dependency** is a package that your dependency needs, so it enters your build through another package.

In the checkout web app, `@stripe/stripe-js` might be a direct dependency in `package.json`. If it depends on another package, that other package enters the application as a transitive dependency. In the Python risk API, your code may import `requests`, and `requests` may depend on packages such as `urllib3` and `certifi`. In the Java settlement worker, your `payments-core` library may pull in Jackson, logging libraries, test helpers, or HTTP clients.

Here is a simple Node example:

```json
{
  "dependencies": {
    "@acme/ui-tokens": "3.8.2",
    "@stripe/stripe-js": "3.5.0"
  }
}
```

That `package.json` shows the direct dependencies. The full installed graph can contain many more packages, because each direct dependency brings its own dependencies. A reviewer usually looks at both the manifest and the generated dependency graph.

```bash
npm explain @acme/ui-tokens
npm ls --all --depth=3
```

For Python, the equivalent review often starts with the files your team uses to pin dependency versions. Some teams use `requirements.txt`. Some use `pyproject.toml` plus a lockfile generated by a tool such as Poetry, uv, or pip-tools. The important habit stays the same: inspect the resolved graph, not only the package your code imports.

```bash
python -m pip install --dry-run --report pip-report.json -r requirements.txt
python -m pip inspect
```

For Maven, the dependency tree gives the reviewer a concrete view of what changed:

```bash
mvn dependency:tree -Dincludes=com.fasterxml.jackson.core
```

Maven has a useful concept called **dependency mediation**. When two dependencies request different versions of the same artifact, Maven chooses one according to its resolution rules, often the nearest dependency in the tree. This matters because a security fix in one branch of the tree can lose to an older version selected through another path. Production Java teams often use `dependencyManagement` or a Bill of Materials in Maven to control the versions that win across the service.

```xml
<dependencyManagement>
  <dependencies>
    <dependency>
      <groupId>com.fasterxml.jackson</groupId>
      <artifactId>jackson-bom</artifactId>
      <version>2.17.2</version>
      <type>pom</type>
      <scope>import</scope>
    </dependency>
  </dependencies>
</dependencyManagement>
```

This example tells Maven which Jackson family versions the project should align around. The reviewer still checks the tree, but the build has a controlled place for version decisions instead of letting every transitive path negotiate versions on its own.

![Dependency graph review infographic showing direct dependencies expanding into transitive packages, then lockfile and reviewer checks for version, source, hash, scripts, and rollback](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/dependency-graph-review.png)

*A dependency update review follows the graph from the direct package to transitive packages, then checks the lockfile and rollback path before release.*

Now the pull request has a shape. The reviewer knows the package names, the registries, and the dependency graph. The next thing to inspect is the lockfile, because the lockfile records the exact package versions and sources the build will use.

## Lockfiles and Repeatable Installs
<!-- section-summary: Lockfiles turn broad version ranges into exact resolved packages, so CI should install from the lockfile and reviewers should inspect source and integrity changes. -->

A **lockfile** records the exact dependency versions selected by the package manager. In npm, that file is usually `package-lock.json`. In Python, the exact file depends on the tool: `poetry.lock`, `uv.lock`, or a compiled requirements file with hashes. In Maven, there is no single built-in lockfile in the same style as npm, so teams commonly rely on pinned versions, dependency management, repository controls, and reproducible build practices.

The point of a lockfile is simple. A manifest can allow a range, such as `^3.5.0`. The package manager resolves that range to a concrete package version, downloads it from a registry, and writes the result to the lockfile. The next install can use the lockfile so the build receives the same resolved dependency set.

Here is a small npm lockfile shape:

```json
{
  "packages": {
    "node_modules/@acme/ui-tokens": {
      "version": "3.8.2",
      "resolved": "https://npm.pkg.github.com/download/@acme/ui-tokens/3.8.2",
      "integrity": "sha512-example"
    }
  }
}
```

The reviewer cares about `version`, `resolved`, and `integrity`. `version` says what package version the resolver selected. `resolved` shows where the package came from. `integrity` gives npm a way to check that the downloaded package content matches the expected hash. A registry or tarball URL change in the lockfile deserves the same attention as a source-code change.

In CI, npm has a command made for lockfile-based installs:

```bash
npm ci
```

`npm ci` expects an existing `package-lock.json` or `npm-shrinkwrap.json`, and it installs from that lockfile. If the manifest and lockfile disagree, the command fails instead of silently changing the lockfile during CI. That behavior is useful because the pull request should contain the dependency decision. The pipeline should verify that decision, not make a new one during the release.

For Python, teams often add hashes to pinned requirements so pip checks the downloaded artifact content:

```bash
python -m pip install --require-hashes -r requirements.txt
```

```
requests==2.32.3 \
    --hash=sha256:examplehash
pydantic==2.8.2 \
    --hash=sha256:anotherexamplehash
```

The hash is a guardrail against a different artifact arriving under the same version. In real teams, a lock generation tool usually writes these hashes, and reviewers look for unexpected additions, removed hashes, or a package source change. The exact tool can vary, but the review question stays steady: "Did the resolved artifact change in a way we expected?"

For Maven, production teams often use repository managers and pinned dependency versions to keep resolution stable. The reviewer checks `pom.xml`, parent POMs, imported BOMs, and the dependency tree. If the pull request changes a repository URL, a parent version, or a BOM version, that can affect many resolved packages even when the service code did not change.

Lockfiles and pinned versions help the build repeat the same decision. The next risk comes from a decision that resolves the right-looking name from the wrong place. That is dependency confusion.

## Private Namespaces and Dependency Confusion
<!-- section-summary: Dependency confusion happens when a private package name can resolve from a public source, so private naming and registry routing need explicit rules. -->

**Dependency confusion** is a package resolution problem where a build installs a public package when the team expected a private package. The public package may have the same name as an internal package, a higher version number, or a registry path that the package manager chooses first. An attacker can use that behavior by publishing a package name that matches or resembles a private dependency.

Let us use the payments platform example. The checkout web app depends on `@acme/ui-tokens`. That name should come from the company registry. If the `.npmrc` scope rule disappears, or if the package manager can also search a public registry for `@acme` names, the build may try a source the team never intended. The package name looks familiar, but the source changed.

The same pattern can happen in Python. Suppose the internal risk service depends on `acme-risk-rules`. If the install command uses both the internal index and PyPI, and a public package with the same name appears, the resolver has to choose. pip's own documentation warns that `--extra-index-url` creates dependency confusion risk for this reason.

```bash
python -m pip install \
  --index-url https://packages.acme.internal/simple \
  --extra-index-url https://pypi.org/simple \
  acme-risk-rules
```

Many teams handle this by creating explicit private namespace rules. For npm, scoped packages should have a scope-to-registry mapping:

```ini
@acme:registry=https://npm.pkg.github.com
always-auth=true
```

For Python, teams often use an internal package index or proxy that controls which names can resolve from which upstream source. Private packages stay private. Public packages flow through an approved mirror or proxy. The application install command points at the controlled index instead of mixing several indexes at the command line.

```bash
python -m pip install \
  --index-url https://packages.acme.internal/simple \
  -r requirements.txt
```

For Maven, teams use private `groupId` rules such as `com.acme.payments` and repository manager policies. The internal repository owns the `com.acme` namespace. The build settings should direct internal artifacts to the internal repository and public artifacts through an approved mirror. A dependency review should flag new repositories added directly to a project POM because those repositories can change where artifacts resolve from.

```xml
<mirror>
  <id>acme-all</id>
  <mirrorOf>*</mirrorOf>
  <url>https://maven.acme.internal/repository/all</url>
</mirror>
```

The practical review habit is clear. Every internal package needs a protected name and a protected registry route. For npm, that usually means a private scope such as `@acme`. For Python, that can mean an internal index policy and a naming rule that reserves company prefixes. For Maven, that means private `groupId` ownership and repository manager controls. The company should also claim its public organization names where the ecosystem supports that, because unclaimed names can become confusing or dangerous later.

Dependency confusion is about the wrong source. The next risk is about the package itself doing something harmful even when it comes from the source you expected.

## Malicious Packages and Maintainer Risk
<!-- section-summary: A package can harm a build through install scripts, stolen maintainership, typosquatting, unexpected code paths, or compromised release credentials. -->

A **malicious package** is a package that performs harmful behavior. It might steal environment variables during install, download a second-stage script, alter build outputs, open a reverse shell, or collect credentials from common files. The harmful behavior can live in the package code, a generated artifact, or an install-time script.

Package ecosystems make sharing code fast, and that speed is why they are useful. The same speed gives attackers several paths. They can publish a new package with a confusing name, compromise a maintainer account, take over an abandoned package, sneak harmful code into a transitive dependency, or use install scripts to run code before your application even starts.

npm packages can define lifecycle scripts such as `preinstall`, `install`, and `postinstall`. Many legitimate packages use scripts to compile native modules or prepare assets. A reviewer treats a new or changed install script as high-signal because it runs during package installation in developer machines and CI jobs.

```json
{
  "scripts": {
    "postinstall": "node scripts/setup.js"
  }
}
```

Python packages can run build backends and setup logic while creating or installing distributions. Modern packaging has improved isolation and metadata, but the reviewer still cares about package source, build backend changes, and artifacts. A package that changes from a wheel to an sdist can cause build-time code to run in places where the team expected a prebuilt artifact.

Java library installation usually runs through Maven artifact resolution rather than arbitrary lifecycle scripts, but a malicious or compromised Java library can still execute when application code loads it, when a framework discovers it, or when tests and build plugins run. Maven plugins deserve special attention because plugins run as part of the build.

Industrial teams combine several signals instead of trusting one score. They look at maintainer activity, release history, repository health, security advisories, known malicious reports, package age, download patterns, and whether a package is needed at runtime or only during development. OpenSSF Scorecard can help assess project security practices such as branch protection, dependency update behavior, token permissions, and release practices. GitHub Dependency Review and the GitHub Advisory Database can add pull-request and advisory signals for repositories that use GitHub.

For packages your own organization publishes, registry account security matters too. PyPI project roles separate owners, who manage the project and collaborators, from maintainers, who can upload releases. PyPI Trusted Publishing uses short-lived publishing tokens through trusted CI/CD identity, so a release workflow can publish without storing a long-lived PyPI API token in repository secrets. That same idea appears across modern package ecosystems: fewer static release secrets, clearer ownership, and stronger links between a release and the workflow that produced it.

Here is a useful way to talk through the payment team's pull request. If `@stripe/stripe-js` updates from one well-known version to another, the reviewer still checks the lockfile source, release notes, and advisory status. If `@acme/ui-tokens` starts resolving from a public URL, the reviewer stops the change because the package source violated the private namespace rule. If a new transitive npm package appears with a `postinstall` script and a two-day-old maintainer account, the reviewer asks for deeper investigation before merging.

Malicious package review can sound like a security-only activity, but developers do most of this work inside normal pull requests. That brings us to a practical review flow.

## Reviewing a Dependency Update
<!-- section-summary: A good dependency review checks intent, source, graph changes, install behavior, advisories, and rollback before the update reaches production. -->

Now the automated update pull request is on your screen. The goal is to review it like a normal engineering change with a few supply chain questions added. The reviewer wants to know what changed, why it changed, where it came from, and how the team can recover if the update causes trouble.

The first pass checks the intent of the change. A patch update for a known vulnerability usually has a clear reason. A major version upgrade across many packages may need a larger compatibility review. A new direct dependency needs a product or engineering reason, because every direct dependency joins the system your team maintains.

The second pass checks the package sources. For npm, the reviewer inspects `package-lock.json` for `resolved` URL changes:

```bash
git diff -- package.json package-lock.json
```

For Python, the reviewer checks the requirements or lockfile and any package index configuration:

```bash
git diff -- requirements.txt pyproject.toml poetry.lock uv.lock
python -m pip install --dry-run --report pip-report.json -r requirements.txt
```

For Maven, the reviewer checks direct dependency changes, parent POM changes, repository changes, and the resolved tree:

```bash
git diff -- pom.xml
mvn dependency:tree
```

The third pass checks for install-time behavior. In npm, a reviewer can inspect package metadata and package contents for lifecycle scripts:

```bash
npm view some-package scripts dist-tags versions
npm pack some-package@1.2.3 --dry-run
```

For Python, the reviewer checks package metadata, whether the resolver selected wheels or source distributions, and whether hashes match the generated lock. For Maven, the reviewer checks whether the change added or changed build plugins, because plugins execute during the build.

The fourth pass checks advisory and project health signals. A production team may use a commercial SCA tool, GitHub dependency review, OpenSSF Scorecard, OSV, npm audit, pip-audit, Maven audit tooling, or an internal policy engine. SCA means **software composition analysis**, which is the practice of identifying open source components, versions, licenses, and known vulnerabilities in your application. The tool matters less than the review behavior: the team needs a consistent place where dependency findings appear before release.

The fifth pass checks rollback. The reviewer should know how to undo the update if production errors rise after deployment. For this payments platform, rollback can mean reverting the dependency pull request, restoring the previous lockfile, and redeploying the last known good image. If the registry source changed, rollback also means correcting the registry rule and invalidating any cached artifact from the wrong source.

Here is a compact review checklist the payments team could put in a pull request template:

```md
## Dependency Review

- Direct dependencies changed:
- Transitive dependencies with source changes:
- Private packages still resolve from the private registry:
- Lockfile integrity or hash changes reviewed:
- Install scripts or build plugins added or changed:
- Security advisories reviewed:
- License or policy issues reviewed:
- Rollback path:
```

This checklist keeps the review concrete. It also helps junior engineers see that dependency security is not a mystery process. It is a careful version of questions they already ask in code review: what changed, why, what else did it pull in, and how do we recover?

The review flow protects a single pull request. The next step is making the pipeline enforce the parts that should never depend only on memory.

## Guardrails in CI/CD
<!-- section-summary: CI/CD guardrails make dependency rules repeatable by failing builds on source drift, lockfile drift, advisories, and policy violations. -->

**CI/CD** is the automated system that builds, tests, and releases code. A human can review one dependency pull request carefully, but a platform team needs repeatable checks because dependency changes happen every week. Guardrails turn the team's rules into pipeline behavior.

The first guardrail is a clean install from the lockfile. For npm, the pipeline should use `npm ci`, because it fails when the manifest and lockfile disagree:

```yaml
name: dependency-check

on:
  pull_request:

jobs:
  node-dependencies:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=high
```

The second guardrail is dependency review during pull requests. GitHub's Dependency Review action can fail a pull request when it introduces vulnerabilities or policy issues, depending on how the repository configures it:

```yaml
name: dependency-review

on:
  pull_request:

jobs:
  dependency-review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
```

The third guardrail is registry policy. A platform team can write a small script or policy check that fails a pull request when internal packages resolve from public URLs. The exact implementation depends on the package manager, but the idea stays simple:

```bash
node scripts/check-npm-registry-rules.mjs package-lock.json
python scripts/check-python-index-rules.py requirements.txt
mvn dependency:tree -DoutputFile=target/dependency-tree.txt
```

The fourth guardrail is package health and maintainer signal. OpenSSF Scorecard can run against source repositories for important open source dependencies. A team might require deeper review for new runtime dependencies below a chosen score, new packages with very little release history, or packages that lack basic project security controls.

```bash
scorecard --repo=https://github.com/ossf/scorecard
```

The fifth guardrail is artifact control. Mature teams often route dependency downloads through an internal repository manager. That gives the organization a place to cache approved artifacts, block known malicious packages, enforce private namespace rules, and record which build downloaded which artifact. The registry manager cannot replace code review, but it gives the pipeline a controlled supply point instead of every build reaching directly to the internet.

These checks should produce clear output. A failed build that says "dependency risk failed" leaves the developer guessing. A useful failure says something like: `@acme/ui-tokens resolved from registry.npmjs.org, expected npm.pkg.github.com`, or `new transitive package left-pad-example contains postinstall script`, or `jackson-databind selected 2.12.7 while policy requires 2.17.x`.

Now we can connect the whole review from package name to release decision.

## Putting It All Together
<!-- section-summary: Dependency safety comes from checking the source, graph, lockfile, package behavior, policy signals, and rollback path together. -->

The payments platform pull request started as a normal dependency update. By the end of the review, the team has answered the questions that matter for secure delivery.

**Package names and registries** answer where the code comes from. `@acme/ui-tokens` must resolve through the private npm scope. `acme-risk-rules` must resolve through the internal Python index. `com.acme.payments:payments-core` must resolve through the internal Maven repository.

**Direct and transitive dependencies** answer what enters the build. The package your service imports may bring in many more packages. The dependency tree or resolver report shows the full graph, including versions your team did not name directly.

**Lockfiles and pinned versions** answer which exact artifacts the build will install. A changed `resolved` URL, integrity hash, source distribution, repository URL, parent POM, or BOM version can matter as much as a changed line of application code.

**Private namespace rules** reduce dependency confusion risk. The company owns its package names, maps private names to private registries, avoids ambiguous resolver paths, and reviews any configuration that changes where packages resolve from.

**Malicious package review** looks at behavior and trust signals. Install scripts, build plugins, maintainer changes, advisory data, release history, and project health all help the reviewer decide whether the update deserves normal approval or deeper investigation.

**CI/CD guardrails** make the rules repeatable. Lockfile installs, dependency review actions, advisory checks, registry policy checks, and internal repository managers catch common failures before a release.

In a real incident, these details give the team a path. If a package source changes unexpectedly, the team can block the pull request before merge. If a malicious package reaches a build cache, the team can identify which jobs downloaded it and purge the artifact. If a vulnerability appears in a transitive package, the team can find which service pulled it in and update the dependency path that controls it.

That is the core work of dependency and package risk: know the names, know the sources, know the resolved graph, and make the release pipeline verify those decisions every time.

![Dependency risk review loop infographic showing source, graph, lockfile, behavior, signals, and rollback around a pull request and release path](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/dependency-risk-review-loop.png)

*A complete dependency review loops through source, graph, lockfile, package behavior, external signals, and rollback before the update becomes a release.*

## Next: SBOMs and Reachability

The next step is turning dependency knowledge into inventory. An **SBOM**, or software bill of materials, lists the components inside an application so teams can answer, "Do we use this package anywhere?" Reachability analysis goes one step further and asks whether vulnerable code appears in a path the application can actually execute.

This article focused on the package review that happens before release. The next articles build on that review by showing how teams record what they shipped, search that inventory during advisories, and decide which findings need urgent remediation.

---

**References**

- [npm package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json) - Documents how npm records resolved dependency trees, package versions, resolved URLs, and integrity values.
- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) - Explains lockfile-based clean installs for automated environments.
- [npm scopes](https://docs.npmjs.com/cli/v11/using-npm/scope) - Explains scoped package names and associating scopes with registries.
- [pip install](https://pip.pypa.io/en/latest/cli/pip_install/) - Documents package indexes and warns that `--extra-index-url` can create dependency confusion risk.
- [pip secure installs](https://pip.pypa.io/en/latest/topics/secure-installs/) - Describes hash-checking mode and repeatable secure install practices.
- [PyPI roles and entities](https://docs.pypi.org/organization-accounts/roles-entities/) - Documents owner and maintainer roles for PyPI projects and organizations.
- [PyPI Trusted Publishers security model](https://docs.pypi.org/trusted-publishers/security-model/) - Explains Trusted Publishing as a more secure alternative to long-lived PyPI API tokens.
- [Maven introduction to the dependency mechanism](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html) - Explains transitive dependencies, dependency mediation, dependency management, optional dependencies, and exclusions.
- [Apache Maven Dependency Plugin dependency:tree](https://maven.apache.org/plugins/maven-dependency-plugin/tree-mojo.html) - Documents the dependency tree goal used to inspect resolved Maven dependencies.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) - Provides automated checks for open source project security practices.
- [GitHub Dependency Review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review) - Explains pull-request dependency review for dependency changes and vulnerability signals.
- [GitHub Advisory Database](https://docs.github.com/en/code-security/security-advisories/global-security-advisories/about-the-github-advisory-database) - Documents GitHub's reviewed advisory database for open source vulnerabilities and malware advisories.
- [Microsoft dependency confusion research](https://www.microsoft.com/en-us/security/blog/2026/05/29/33-malicious-npm-packages-abuse-dependency-confusion-profile-developer-environments/) - Describes a 2026 malicious npm package campaign that abused dependency confusion patterns.
