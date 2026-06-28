---
title: "Dependency and Package Risk"
description: "Review third-party packages, registries, dependency graphs, lockfiles, dependency confusion, maintainer risk, and CI guardrails before a release trusts them."
overview: "Start with one dependency update pull request for Harbor Books. Follow the package name to its registry, direct and transitive dependencies, lockfile evidence, dependency confusion risk, malicious package behavior, review steps, and CI guardrails."
tags: ["devsecops", "dependencies", "package-registries", "lockfiles"]
order: 1
id: article-devsecops-pipeline-security-dependency-scanning
---

## Table of Contents

1. [Your App Uses Other People's Code](#your-app-uses-other-peoples-code)
2. [The Dependency Update PR](#the-dependency-update-pr)
3. [Package Name and Registry](#package-name-and-registry)
4. [Direct and Transitive Dependencies](#direct-and-transitive-dependencies)
5. [Lockfile as Release Evidence](#lockfile-as-release-evidence)
6. [Dependency Confusion and Private Names](#dependency-confusion-and-private-names)
7. [Malicious Packages and Maintainer Risk](#malicious-packages-and-maintainer-risk)
8. [Review the Update PR](#review-the-update-pr)
9. [CI Guardrails](#ci-guardrails)
10. [Production Checklist](#production-checklist)
11. [Next: SBOMs and Reachability](#next-sboms-and-reachability)
12. [References](#references)

## Your App Uses Other People's Code
<!-- section-summary: Dependency risk starts with the ordinary fact that production software imports code from package ecosystems and internal registries. -->

Your app uses other people's code. That is normal. A checkout service that writes every HTTP client, date parser, test runner, UI helper, and logging library from scratch would move slowly and still make security mistakes. Modern delivery works because teams reuse packages from ecosystems such as npm, PyPI, Maven Central, Linux distributions, and internal registries.

A **dependency** is software your application relies on. For Harbor Books, `checkout-api` uses a private package named `@harbor/coupon-rules` to evaluate partner coupon rules. It also uses public packages for logging, JSON parsing, tests, and build tooling. When one of those packages changes, new code enters the release even when no engineer changed a business logic file.

This article follows one dependency update pull request. The pull request looks small at first: one private package moves from `2.4.1` to `2.4.2`, and the lockfile changes. The secure delivery question is larger than the diff count. Which package changed? Which registry served it? Which transitive dependencies came with it? Which lockfile entries changed? Could the build resolve a private name from the wrong place? Did a maintainer or install script change the risk?

The answer should live inside careful code review. We will start with the pull request, then walk through the evidence a reviewer and CI system should check before production trusts the update.

## The Dependency Update PR
<!-- section-summary: One update pull request gives the article a concrete release path from package name to CI policy. -->

Harbor Books sells books online, and `checkout-api` decides whether a coupon can apply to a cart. Maya opens the automated dependency update pull request from Renovate. The title is ordinary: `Update @harbor/coupon-rules to 2.4.2`.

The manifest diff is small:

```json
{
  "dependencies": {
    "@harbor/coupon-rules": "2.4.2"
  }
}
```

The reviewer reads this as one direct dependency change. **Direct dependency** means the project names the package in its own manifest. The old version was `2.4.1`, and the new version is `2.4.2`. That sounds safe, but a package update can change more than one line of application behavior.

The pull request also changes `package-lock.json`. The lockfile records where npm resolved the package, which exact tarball it selected, and which integrity hash npm expects. A private package such as `@harbor/coupon-rules` should come from Harbor Books' approved registry, not from the public npm registry or an unexpected mirror.

Here is the review spine for this pull request:

| Review question | Harbor Books example |
|---|---|
| What package changed? | `@harbor/coupon-rules` |
| Where should it come from? | Harbor Books' private npm registry |
| Is it direct or transitive? | Direct dependency in `checkout-api` |
| What did the lockfile resolve? | Version, tarball URL, integrity hash, and dependencies |
| Could another registry win? | Check `.npmrc` scope rules and registry policy |
| Did package behavior change? | Check scripts, changelog, maintainer, and new dependencies |
| Can CI enforce the rule? | Lockfile install, dependency review, registry checks, and audit policy |

Now we can walk those questions in order, starting with the package name and registry.

## Package Name and Registry
<!-- section-summary: A package name needs a registry source before a reviewer can decide whether the build downloaded the intended software. -->

A **package registry** is the service that stores packages and package metadata. npm has the public npm registry. Python packages usually come from PyPI. Java dependencies often come from Maven Central. Companies also run private registries through GitHub Packages, Artifactory, Nexus, AWS CodeArtifact, Azure Artifacts, or another internal service.

A package name only has useful security meaning together with its registry. The name `@harbor/coupon-rules` should refer to Harbor Books' internal package in the private registry. If npm resolves the same name from another registry, the pull request has changed the release input even though the name looks familiar.

For npm, the scope is the part before the slash. The scope `@harbor` can be mapped to a private registry in `.npmrc`:

```ini
@harbor:registry=https://npm.pkg.github.com
registry=https://registry.npmjs.org/
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
```

`@harbor:registry` sends packages under the `@harbor` scope to GitHub Packages. The plain `registry` line leaves normal public packages on the public npm registry. The auth token line lets CI authenticate to the private registry. A reviewer should treat a change to this file like a production route change, because it changes where dependency bytes come from.

Python and Java have the same source question with different files. pip can install from PyPI, an internal index, or both. Maven resolves artifacts from repositories configured in project or user settings. A dependency review checks those routes with the same plain question: does each private name resolve from the private source?

```bash
python -m pip install \
  --index-url https://packages.harborbooks.internal/simple \
  -r requirements.txt
```

This pip command uses one controlled index. `--index-url` names the package index pip should query. Harbor Books would avoid putting private names on a command that also searches a public index through `--extra-index-url`, since pip documents dependency confusion risk for that pattern.

```xml
<dependency>
  <groupId>com.harborbooks.checkout</groupId>
  <artifactId>coupon-rules</artifactId>
  <version>2.4.2</version>
</dependency>
```

In Maven, `groupId`, `artifactId`, and `version` identify the package. Harbor Books owns the `com.harborbooks` group in its internal repository manager. Public Java libraries can flow through an approved mirror, while internal group IDs should resolve from the internal repository.

![Package source check infographic showing a dependency manifest, registry rule, lockfile resolved URL, and allow or block decision for private and public registries](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/package-source-check.png)

*A dependency name earns trust only after the manifest, registry rule, and lockfile point to the expected source.*

Once the package source is clear, the reviewer needs the full graph. A direct package can carry other packages into the build.

## Direct and Transitive Dependencies
<!-- section-summary: Direct dependencies are named by the project, while transitive dependencies arrive through the packages the project already uses. -->

A **direct dependency** is a package your project names in its manifest. A **transitive dependency** is a package that arrives because another package depends on it. Your code may import `@harbor/coupon-rules`, and that package may depend on a parser, a date library, or a small utility package that your service never names directly.

Transitive dependencies are still part of the release. If a transitive package gains an install script, changes maintainers, or brings a vulnerable version, production still receives that code through the dependency graph. The reviewer therefore checks the graph instead of stopping at `package.json`.

For the Harbor Books pull request, the reviewer can inspect why the package exists:

```bash
npm explain @harbor/coupon-rules
npm ls @harbor/coupon-rules --all
```

`npm explain` shows why npm installed a package and which dependency path pulled it in. `npm ls --all` prints the resolved tree under that package. The reviewer uses these commands to confirm that `checkout-api` depends on the package directly and to see whether the update brought any new packages with it.

Example output can look like this:

```bash
@harbor/coupon-rules@2.4.2
node_modules/@harbor/coupon-rules
  @harbor/coupon-rules@"2.4.2" from the root project
```

Python and Maven reviewers use different commands for the same graph question:

```bash
python -m pip install --dry-run --report pip-report.json -r requirements.txt
python -m pip inspect
mvn dependency:tree -Dincludes=com.harborbooks.checkout:coupon-rules
```

`pip install --dry-run --report` shows what pip would install without changing the environment. `pip inspect` reports installed package metadata in JSON. `mvn dependency:tree` prints the Maven dependency graph and helps Java teams see which path selected a package version.

Maven adds one important production detail called **dependency mediation**. When two branches of the dependency graph request different versions of the same artifact, Maven chooses one according to its resolution rules. Teams often use `dependencyManagement` or a Maven BOM to make version choices explicit across the service.

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

This block imports a Jackson bill of materials. `dependencyManagement` gives the project one place to control resolved Jackson versions. `type` and `scope` tell Maven to import version guidance from the BOM instead of treating it like a normal runtime jar.

![Dependency graph review infographic showing direct dependencies expanding into transitive packages, then lockfile and reviewer checks for version, source, hash, scripts, and rollback](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/dependency-graph-review.png)

*A dependency review follows the direct package into the transitive graph before it trusts the final resolved set.*

The graph tells the reviewer what can enter the build. The lockfile tells the reviewer exactly what the resolver selected.

## Lockfile as Release Evidence
<!-- section-summary: Lockfiles record exact resolved versions, sources, and integrity data so CI can repeat the same dependency decision. -->

A **lockfile** records the exact package versions and artifact metadata selected by the package manager. For npm, the file is usually `package-lock.json`. Python teams may use `poetry.lock`, `uv.lock`, or a compiled requirements file with hashes. Maven teams usually rely on pinned versions, dependency management, repository manager controls, and reproducible build settings instead of one built-in lockfile.

The Harbor Books pull request changes this lockfile entry:

```json
{
  "node_modules/@harbor/coupon-rules": {
    "version": "2.4.2",
    "resolved": "https://npm.pkg.github.com/download/@harbor/coupon-rules/2.4.2",
    "integrity": "sha512-exampleHashForTheTarball",
    "dependencies": {
      "coupon-expression-parser": "1.7.4"
    }
  }
}
```

`version` is the resolved package version. `resolved` is the tarball source npm will fetch. `integrity` is a hash that lets npm check the downloaded package content. The `dependencies` object shows packages pulled by `@harbor/coupon-rules`. A source URL or integrity change deserves review because it changes the exact artifact CI will install.

CI should install from the lockfile instead of letting the resolver make a fresh decision during the release. npm has a command for this:

```bash
npm ci
```

`npm ci` expects the manifest and lockfile to agree. If the pull request updates `package.json` without updating `package-lock.json`, the command fails. That failure is useful because the dependency decision should appear in the reviewed pull request instead of hidden lockfile churn inside CI.

Python teams can get similar repeatability with pinned requirements and hashes:

```bash
python -m pip install --require-hashes -r requirements.txt
```

```bash
requests==2.32.3 \
    --hash=sha256:examplehash
pydantic==2.8.2 \
    --hash=sha256:anotherexamplehash
```

`--require-hashes` tells pip to require hashes for installed packages. Each `--hash` line pins an expected artifact hash. Lock-generation tools usually write these files, and reviewers look for unexpected package additions, removed hashes, or source changes.

The lockfile gives the reviewer a stable artifact list. The next risk appears when a private package name can resolve from the wrong place.

## Dependency Confusion and Private Names
<!-- section-summary: Dependency confusion happens when a build can choose a public package where the team expected a private package. -->

**Dependency confusion** is a package resolution problem. A build expects a private package, but the resolver can also find a public package with the same name or a higher version. An attacker can abuse that ambiguity by publishing a package that looks like an internal dependency and waiting for a misconfigured build to install it.

For Harbor Books, `@harbor/coupon-rules` should resolve only from the private registry. If the `.npmrc` scope rule disappears, or if a registry proxy allows private names to fall through to the public npm registry, a public package could satisfy a private-looking dependency. The name alone would look right during a quick review, while the source would be wrong.

The npm control is a scope-to-registry mapping:

```ini
@harbor:registry=https://npm.pkg.github.com
always-auth=true
```

`@harbor:registry` reserves the scope route. `always-auth` makes npm send credentials for requests to the configured registry, which helps private registry access behave consistently in CI. The platform team should also own the public organization names where the ecosystem supports that, since unclaimed names can create confusion later.

The Python control is usually an internal index or proxy that owns private names and mirrors approved public packages. Harbor Books would install through that controlled source:

```bash
python -m pip install \
  --index-url https://packages.harborbooks.internal/simple \
  -r requirements.txt
```

The Maven control is private `groupId` ownership plus repository manager policy:

```xml
<mirror>
  <id>harborbooks-all</id>
  <mirrorOf>*</mirrorOf>
  <url>https://maven.harborbooks.internal/repository/all</url>
</mirror>
```

`mirrorOf` set to `*` sends Maven resolution through the controlled repository manager. The repository manager can decide which public artifacts are mirrored and which internal group IDs stay internal. A dependency pull request that adds a new repository directly to a project POM should get careful review, because it changes the resolver route.

Dependency confusion is a source problem. The next risk sits inside the package itself.

## Malicious Packages and Maintainer Risk
<!-- section-summary: A package can introduce risk through harmful scripts, compromised maintainers, abandoned projects, typosquatting, or build-time behavior. -->

A **malicious package** is a package that intentionally performs harmful behavior. It might read CI secrets, send environment variables away, download a second-stage script, alter a build output, or hide behavior in generated files. The harmful behavior can run during install, build, tests, or application runtime.

Package ecosystems move quickly, and speed creates several attacker paths. An attacker can publish a confusing name, compromise a maintainer account, take over an abandoned package, add harmful code to a transitive dependency, or abuse install hooks. A reviewer checks package behavior and maintainer signals together instead of relying on version number alone.

npm packages can define lifecycle scripts such as `preinstall`, `install`, and `postinstall`:

```json
{
  "scripts": {
    "postinstall": "node scripts/setup.js"
  }
}
```

Many legitimate packages use scripts to compile native modules or prepare assets. A new or changed install script still gets attention because it runs on developer machines and CI runners during installation. If `@harbor/coupon-rules` adds a new transitive package with a `postinstall` script, the reviewer asks what it does and why the service needs it.

Python packages can run build backends while creating or installing distributions. A switch from a wheel to a source distribution can introduce build-time code where the team expected a prebuilt artifact. Maven library resolution usually avoids arbitrary install scripts, but Maven plugins execute during the build and deserve separate review.

Maintainer risk is the human and project side of the same question. The reviewer looks at release history, project activity, security advisories, ownership changes, package age, source repository health, and whether the package is needed at runtime or only in development. OpenSSF Scorecard, GitHub Dependency Review, OSV, npm audit, pip-audit, Maven audit tooling, and commercial software composition analysis tools can add signals, but the pull request still needs a human owner for the decision.

For Harbor Books, the review may end in three different ways. A routine patch from the known private registry with no new scripts can continue. A private package that resolves from a public URL stops immediately. A new transitive package with a two-day-old maintainer account and an install script gets deeper review before merge.

Now we can turn those ideas into a practical pull request review.

## Review the Update PR
<!-- section-summary: A dependency review checks intent, source, graph changes, lockfile evidence, scripts, advisory data, and rollback. -->

The dependency update pull request should be reviewed like a normal engineering change with extra supply-chain questions. The reviewer wants to know what changed, why it changed, what else it pulled in, which source supplied it, and how Harbor Books can recover if the update causes trouble.

The first pass checks intent. A patch update for a bug fix or security advisory usually has a clear reason. A major version update needs compatibility review. A new direct dependency needs an engineering reason, because the team must track that package after merge.

The second pass checks package source and lockfile entries:

```bash
git diff -- package.json package-lock.json .npmrc
npm explain @harbor/coupon-rules
npm view @harbor/coupon-rules@2.4.2 name version dist.integrity
```

`git diff` shows manifest, lockfile, and registry route changes. `npm explain` shows the dependency path. `npm view` reads package metadata from the configured registry. The reviewer checks that the package name, version, source, and integrity match the update they expected.

The third pass checks package contents before the build trusts them:

```bash
npm pack @harbor/coupon-rules@2.4.2 --dry-run
npm view @harbor/coupon-rules@2.4.2 scripts dependencies
```

`npm pack --dry-run` shows which files would be included in the package tarball. The `scripts` and `dependencies` metadata help the reviewer spot install-time behavior and newly introduced transitive packages.

The fourth pass checks advisory and policy signals. The team may use GitHub Dependency Review, npm audit, OSV, OpenSSF Scorecard, OWASP guidance, or a commercial SCA tool. **Software composition analysis**, or **SCA**, means identifying components, versions, licenses, and known vulnerabilities in the software your team builds.

The fifth pass checks rollback. Harbor Books should be able to revert the dependency pull request, restore the previous lockfile, rebuild the last known good image, and redeploy the previous signed digest. If the registry route changed, rollback also includes fixing the registry rule and purging any cached artifact from the wrong source.

A pull request template can keep this review steady:

```md
## Dependency Review

- Direct dependencies changed:
- Transitive packages added or removed:
- Private packages still resolve from the private registry:
- Lockfile source and integrity changes reviewed:
- Install scripts or build plugins added or changed:
- Vulnerability, license, and package-health signals reviewed:
- Rollback path:
```

This checklist gives junior reviewers a concrete path. It also gives CI a clear set of rules to automate.

## CI Guardrails
<!-- section-summary: CI guardrails turn dependency review rules into repeatable checks for every pull request and release. -->

**CI/CD** is the automation that builds, tests, scans, and releases code. Human review can catch unusual dependency changes, and CI should enforce rules that always apply. The strongest setup uses both: reviewers handle judgment, and automation handles repeatable facts.

Harbor Books starts with a clean lockfile install and audit:

```yaml
name: dependency-check

on:
  pull_request:

jobs:
  node-dependencies:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm audit --audit-level=high
```

`npm ci` verifies that the lockfile can reproduce the dependency set. `npm audit --audit-level=high` checks npm advisory data and fails on high-severity findings according to npm's audit behavior. Some teams replace or supplement this with OSV, GitHub Dependabot alerts, OWASP Dependency-Check, or commercial SCA tools.

GitHub Dependency Review can add pull-request feedback when dependency changes introduce vulnerabilities or policy issues:

```yaml
name: dependency-review

on:
  pull_request:

jobs:
  dependency-review:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
```

Registry policy should also run in CI. Harbor Books can write a small check that reads `package-lock.json` and fails when internal packages resolve from an unapproved host:

```bash
node scripts/check-npm-registry-rules.mjs package-lock.json
```

A useful failure message should tell the developer exactly what broke:

```bash
@harbor/coupon-rules resolved from registry.npmjs.org, expected npm.pkg.github.com
```

That output points to the fix. The developer can check `.npmrc`, registry credentials, and lockfile source entries instead of guessing why "dependency policy" failed.

The final CI habit is artifact control. Mature teams route package downloads through an internal repository manager or registry proxy. That gives the organization a place to cache approved artifacts, block known malicious packages, enforce private namespace rules, and record which build downloaded which package.

## Production Checklist
<!-- section-summary: Dependency safety comes from checking names, sources, graphs, lockfiles, package behavior, policy signals, and rollback together. -->

By the end of the Harbor Books review, the team has answered the important questions for `@harbor/coupon-rules`:

| Area | Good answer |
|---|---|
| Package identity | `@harbor/coupon-rules` changed from `2.4.1` to `2.4.2` |
| Registry source | The `@harbor` scope resolves from the private registry |
| Dependency graph | New direct and transitive packages are visible in review |
| Lockfile evidence | `version`, `resolved`, `integrity`, and dependencies are reviewed |
| Confusion risk | Private names have explicit registry routes and no public fallback |
| Package behavior | Install scripts, build plugins, and package contents are reviewed |
| Maintainer signal | Advisory, release history, and project-health signals are checked |
| CI guardrails | Lockfile install, dependency review, registry checks, and audit policy run on PRs |
| Rollback | The team can restore the previous lockfile and deploy the previous signed digest |

This is the core work of dependency and package risk. Know the names. Know the sources. Know the graph. Keep the lockfile honest. Give reviewers a checklist. Give CI repeatable checks. Keep a rollback path close to the release record.

![Dependency risk review loop infographic showing source, graph, lockfile, behavior, signals, and rollback around a pull request and release path](/content-assets/articles/article-devsecops-pipeline-security-dependency-scanning/dependency-risk-review-loop.png)

*A dependency update review loops through source, graph, lockfile, package behavior, external signals, and rollback before release.*

## Next: SBOMs and Reachability

The dependency pull request gave Harbor Books confidence before merge. After release, the team needs inventory. If a new advisory appears tomorrow, security will ask: which services contain this vulnerable package, which versions are deployed, and which image digest carried it into production?

The next article answers that inventory question with SBOMs, then adds reachability so Harbor Books can separate package presence from real exposure.

---

## References

- [npm package-lock.json](https://docs.npmjs.com/cli/v11/configuring-npm/package-lock-json) - npm documentation for lockfile structure, resolved URLs, integrity, and dependency tree data.
- [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci) - npm documentation for clean lockfile installs in automated environments.
- [npm scopes](https://docs.npmjs.com/cli/v11/using-npm/scope) - npm documentation for scoped package names and registry association.
- [pip install](https://pip.pypa.io/en/latest/cli/pip_install/) - pip documentation for package indexes, including dependency confusion warnings around extra indexes.
- [pip secure installs](https://pip.pypa.io/en/latest/topics/secure-installs/) - pip documentation for hash-checking mode and repeatable installs.
- [Maven dependency mechanism](https://maven.apache.org/guides/introduction/introduction-to-dependency-mechanism.html) - Maven documentation for transitive dependencies, mediation, dependency management, and BOMs.
- [OWASP Top 10: Vulnerable and Outdated Components](https://owasp.org/Top10/A06_2021-Vulnerable_and_Outdated_Components/) - OWASP guidance on risks from vulnerable, unsupported, or misconfigured components.
- [OWASP Software Component Verification Standard](https://owasp.org/www-project-software-component-verification-standard/) - OWASP project for software component inventory, provenance, and verification practices.
- [GitHub Dependency Review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review) - GitHub documentation for pull-request dependency review.
- [OpenSSF Scorecard](https://github.com/ossf/scorecard) - OpenSSF tool for assessing open source project security practices.
