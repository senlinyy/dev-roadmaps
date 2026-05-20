---
title: "Dependency Scanning"
description: "Read dependency findings, lockfiles, and package evidence so vulnerable or malicious packages become reviewable engineering work."
overview: "Dependency scanning connects package metadata to delivery risk. This article uses npm examples, the PyTorch dependency-confusion incident, and practical lockfile evidence to explain what scanners can and cannot decide."
tags: ["dependencies", "npm", "vulnerabilities", "supply-chain"]
order: 2
id: article-devsecops-pipeline-security-dependency-scanning
---

## Table of Contents

1. [What Dependency Scanning Does](#what-dependency-scanning-does)
2. [Direct and Transitive Dependencies](#direct-and-transitive-dependencies)
3. [Lockfiles](#lockfiles)
4. [Vulnerability Findings](#vulnerability-findings)
5. [Malicious Packages](#malicious-packages)
6. [Case Study: PyTorch Nightly](#case-study-pytorch-nightly)
7. [Review Evidence](#review-evidence)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Dependency Scanning Does

Dependency scanning reads the packages your project uses and compares them with known vulnerability or malicious-package intelligence. In a Node.js service, the scanner usually reads `package.json` and `package-lock.json`. In other ecosystems, it may read `requirements.txt`, `poetry.lock`, `go.sum`, `Cargo.lock`, Maven files, container package databases, or SBOMs.

The scanner answers one useful question:

```text
Does this project include a package version that is known to be risky?
```

It answers one part of the security question. A scanner may not know whether your code reaches the vulnerable function. It may not detect a brand-new malicious package. It may not understand your production exposure. It gives evidence for review, and the service owner still makes the final decision.

For `devpolaris-orders-api`, dependency scanning belongs in pull requests and release review. It should tell the team when a dependency changed, whether a known vulnerability is present, and which version fixes it.

## Direct and Transitive Dependencies

A direct dependency is listed by your project. A transitive dependency is pulled in by another dependency.

```json
{
  "dependencies": {
    "express": "4.18.2",
    "pg": "8.11.5"
  }
}
```

In this example, `express` and `pg` are direct dependencies. They may pull in many transitive dependencies. Your application can be affected by both kinds because both kinds ship into the install tree.

Here is a simplified dependency tree:

```text
devpolaris-orders-api
|-- express@4.18.2
|   |-- body-parser@1.20.1
|   +-- qs@6.11.0
+-- pg@8.11.5
    +-- pg-protocol@1.6.0
```

If a scanner reports a vulnerable `qs` version, the team may not find `qs` in `package.json`. It is still present because `express` brought it in. The fix may be to update `express`, add a package-manager override, or remove the dependency path entirely.

## Lockfiles

The lockfile records the exact package versions selected by the package manager. It is one of the most important security artifacts in a JavaScript project.

```text
package.json      says what ranges the project accepts
package-lock.json says what versions were actually resolved
node_modules      contains what was installed
```

The lockfile lets reviewers see the actual change. A pull request may edit one direct dependency, but the lockfile may add or change dozens of transitive packages.

```diff
-    "node_modules/example-parser": {
-      "version": "1.4.2"
+    "node_modules/example-parser": {
+      "version": "1.4.3"
       "resolved": "https://registry.npmjs.org/example-parser/-/example-parser-1.4.3.tgz"
       "integrity": "sha512..."
     }
```

The `version` line tells you what changed. The `resolved` line tells you where the package came from. The `integrity` line is the expected package integrity value used by npm to detect tampering with the downloaded tarball.

Do not review dependency changes by `package.json` alone. The lockfile is where the real install result appears.

## Vulnerability Findings

A vulnerability finding should be read as a small evidence packet.

```text
Package: example-parser
Installed version: 1.4.2
Fixed version: 1.4.4
Severity: high
Path: express -> body-parser -> example-parser
Reachability: parser handles request body input
Decision: update express and regenerate lockfile
```

The `Package` and `Installed version` tell you what is present. `Fixed version` tells you the first version that removes the known vulnerability. `Path` explains how the package entered the project. `Reachability` is the local engineering question. `Decision` tells the team what action was chosen.

Severity is useful, but severity is not priority by itself. A critical vulnerability in unused test-only code may be less urgent than a high vulnerability in a request parser exposed to the internet. The scanner starts the conversation. The service owner finishes it with context.

## Malicious Packages

Vulnerable packages and malicious packages are different problems. A vulnerable package has a bug that can be exploited under some conditions. A malicious package intentionally does something harmful, such as stealing tokens, running unexpected install scripts, or replacing build output.

The review questions change:

| Question | Vulnerability | Malicious package |
|----------|---------------|-------------------|
| What version is installed? | Yes | Yes |
| Is the vulnerable code path reachable? | Usually important | Less comforting |
| Did install scripts run? | Sometimes | Very important |
| Were secrets present during install? | Sometimes | Very important |
| Should we rotate credentials? | Depends | Often yes if exposure is plausible |

If a package is known malicious and ran inside CI with secrets present, treat it as a potential secret exposure. Removing the package is not enough. The team needs to know what the package could read while it ran.

## Case Study: PyTorch Nightly

In December 2022, PyTorch disclosed that a malicious package named `torchtriton` had been uploaded to the Python Package Index. Users who installed PyTorch nightly builds during the affected window could receive the malicious dependency because of package resolution behavior involving the public index. PyTorch explained that stable packages were not affected, but nightly users needed to uninstall the malicious package and rotate sensitive credentials if exposure was possible.

This is a dependency-confusion lesson. A build expected one package source, but another source provided a package with a matching name and higher priority in the resolver path. The package name looked legitimate enough to enter the environment.

Read the path:

```text
nightly install
  -> package resolver checks indexes
  -> public package name matches expected dependency
  -> malicious package installs
  -> install-time code can inspect environment
```

The controls are package-source controls and evidence. Use explicit indexes where the ecosystem supports them. Know which package source is trusted for internal names. Review lockfiles or equivalent resolved artifacts. Keep secrets out of install jobs when they are not needed.

## Review Evidence

A dependency review should leave one compact decision.

```text
Finding: example-parser CVE-2026-1234
Service: devpolaris-orders-api
Path: express -> body-parser -> example-parser
Installed: 1.4.2
Fixed: 1.4.4
Exposure: request body parser handles public API input
Action: update express and regenerate lockfile
Owner: orders-team
Due: 2026-05-24
```

This record makes the decision visible. If the scanner reports the same finding tomorrow, the team can see the owner and due date. If the fix breaks tests, the team can see why the update matters.

## Putting It All Together

Dependency scanning makes package risk visible, but the scanner is only the start. The lockfile shows what actually installed. The dependency path shows how the package entered. The service owner decides reachability, priority, and action.

The PyTorch nightly incident shows that package source and resolver behavior are part of security. A package with the expected name can still come from the wrong place. That is why dependency scanning, lockfile review, install-job boundaries, and secret hygiene need to work together.

For `devpolaris-orders-api`, the practical habit is to review dependency changes through the lockfile, keep install jobs low power, treat malicious package execution as possible secret exposure, and leave a decision record for findings that cannot be fixed immediately.

## What's Next

Dependency scanning reads package metadata. Static application security testing reads your source code. The next article explains how SAST and CodeQL find risky code paths before the application runs.

---

**References**

- [PyTorch compromised nightly dependency disclosure](https://pytorch.org/blog/compromised-nightly-dependency/) - PyTorch describes the December 2022 malicious `torchtriton` dependency incident.
- [npm package lock documentation](https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json) - npm documents lockfiles, resolved versions, and package integrity fields.
- [GitHub dependency review](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/about-dependency-review) - GitHub explains dependency review for pull requests.
- [npm: Details about the event-stream incident](https://blog.npmjs.org/post/180565383195/details-about-the-event-stream-incident) - npm documents a malicious transitive dependency case in the JavaScript ecosystem.
