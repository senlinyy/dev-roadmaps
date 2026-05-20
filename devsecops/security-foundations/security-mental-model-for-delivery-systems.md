---
title: "Delivery Trust Model"
description: "Trace how source code, identities, build jobs, artifacts, and evidence become a trusted production change."
overview: "DevSecOps starts with a simple question: which parts of the delivery path are allowed to change production, and what proof do they leave behind? This article builds that mental model using a small service, a real supply-chain case study, and concrete delivery artifacts."
tags: ["security", "delivery", "trust", "supply-chain"]
order: 1
id: article-devsecops-security-foundations-security-mental-model-delivery-systems
aliases:
  - security-mental-model-for-delivery-systems
  - article-devsecops-security-foundations-security-mental-model-delivery-systems
  - devsecops/security-foundations/security-mental-model-for-delivery-systems.md
---

## Table of Contents

1. [What Is a Delivery Trust Model?](#what-is-a-delivery-trust-model)
2. [The Delivery Tree](#the-delivery-tree)
3. [Actors, Permissions, and Targets](#actors-permissions-and-targets)
4. [Workflow Boundaries](#workflow-boundaries)
5. [Artifacts and Provenance](#artifacts-and-provenance)
6. [Case Study: XZ Utils](#case-study-xz-utils)
7. [Evidence You Can Read](#evidence-you-can-read)
8. [Where Trust Breaks](#where-trust-breaks)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## What Is a Delivery Trust Model?

If you have shipped software through a pull request, a CI job, a container registry, or a deployment script, you have already used a delivery system. It is the path that turns a human change into something production runs. The path usually feels ordinary: someone opens a pull request, tests run, a branch merges, an image is built, a deploy job starts, and a service changes.

Security work starts when you ask what each step is allowed to do. A pull request should be able to prove that the code builds. It should not be able to publish a production package. A test job should be able to read the repository. It should not receive the same cloud access as a deployment job. A deployment job should be able to change one service in one environment. It should not become a general administrator for the whole account.

A delivery trust model is the map of those allowed moves. It names the people, services, jobs, files, tokens, artifacts, and logs that take part in delivery. It also names the boundaries between them. A boundary is where one thing gives another thing some trust: a maintainer approves a pull request, GitHub starts a workflow, a workflow receives a token, a cloud provider accepts that token, or Kubernetes accepts a new manifest.

The word "trust" can sound abstract, so keep it practical. Trust means one system accepts another system's claim. The package registry accepts that a publish token is allowed to upload a package. The cloud account accepts that a workflow identity is allowed to deploy. The production cluster accepts that an image digest is allowed to run. A reviewer accepts that the audit trail is enough to explain what happened later.

The running example in this article is `devpolaris-orders-api`, a small Node.js service. It lives in GitHub, builds in GitHub Actions, publishes a container image, and deploys to production through a cloud role. The service is small enough to inspect by hand, but it has the same security questions as a larger platform:

- Who can change the source?
- Which automation runs the change?
- Which identity does the automation receive?
- Which artifact reaches production?
- Which log proves what happened?

Those questions are the foundation for the rest of DevSecOps. Secret scanning, dependency scanning, artifact signing, cloud IAM review, Kubernetes RBAC, incident response, and compliance evidence all become easier when you can trace the delivery path.

## The Delivery Tree

Linux has one filesystem tree rooted at `/`. A delivery system has a similar shape. There is one path from source to production, even if many tools sit along that path. Drawing it as a tree helps because every branch needs a job.

```text
devpolaris-orders-api delivery
|-- source
|   |-- pull request
|   |-- branch protection
|   `-- CODEOWNERS
|-- automation
|   |-- test workflow
|   |-- build workflow
|   `-- deploy workflow
|-- identities
|   |-- GitHub actor
|   |-- GITHUB_TOKEN
|   |-- OIDC subject
|   `-- cloud deploy role
|-- artifacts
|   |-- package lockfile
|   |-- container image digest
|   |-- SBOM
|   `-- provenance record
`-- production
    |-- service
    |-- runtime identity
    |-- audit log
    `-- health check
```

The `source` branch of the tree is where human intent enters the system. A pull request says what changed. Branch protection says which checks and reviews must pass. `CODEOWNERS` says which people or teams must review sensitive paths.

The `automation` branch is where machines act on the change. A test workflow should answer whether the change is safe enough to continue. A build workflow should turn source into an artifact. A deploy workflow should move one approved artifact into one target environment.

The `identities` branch is where permissions live. This is the part many teams skip until something breaks. A workflow is not powerful because it is a YAML file. It is powerful because the platform gives it a token, and another system accepts that token. The token may be the repository's `GITHUB_TOKEN`, an OpenID Connect token, a package registry token, a cloud access token, or a Kubernetes service account token.

The `artifacts` branch is what moves between systems. Source code does not usually run directly in production. A package, container image, Terraform plan, Kubernetes manifest, or release bundle moves instead. If you cannot name the artifact, you cannot reliably prove that production is running the thing the trusted build produced.

The `production` branch is where the change lands. Production has its own identities, logs, health checks, and runtime facts. A deployment is complete only when you can connect the running service back to the source change and artifact that created it.

This tree is useful because it gives review a fixed order. Start with the source. Follow the automation. Name the identity. Record the artifact. Check production. If a security question appears, place it on the tree before trying to fix it.

## Actors, Permissions, and Targets

Most delivery security questions can be reduced to three words: actor, permission, target.

The actor is the person or machine taking the action. The permission is the allowed operation. The target is the thing being changed or read. If any of those three are vague, the system is hard to secure.

Here is a small access table for `devpolaris-orders-api`.

| Actor | Permission | Target | Evidence |
|-----------|------------|--------|----------|
| Developer | Open pull request | `devpolaris-orders-api` repository | Pull request author and commits |
| Reviewer | Approve source change | Protected `main` branch | Review event |
| Test workflow | Read source and install dependencies | Repository and package registry | Workflow run log |
| Build workflow | Publish image | `ghcr.io/devpolaris/orders-api` | Image digest and package event |
| Deploy workflow | Update service | Production app only | Cloud audit log |
| On-call engineer | Read logs | Production log workspace | Access log |

Read the table left to right. `Developer` is an actor. `Open pull request` is the permission. The repository is the target. The pull request author and commits are the evidence. The evidence column matters because access that leaves no usable record becomes difficult to review after the fact.

A table like this also shows the difference between a person and a job. A developer may write the code, but the build workflow publishes the image. The workflow should have package publish permission. The developer does not need a personal production publish token for the normal path.

The target column is where least privilege becomes concrete. "Deploy to production" is still too broad if the same role can change every service, network rule, database, and secret in the account. A better target is "update the `orders-api` service in the production environment." That phrase is longer, but it gives IAM, Kubernetes RBAC, GitHub environments, and audit review something exact to enforce.

There is a common beginner mistake here. Teams often try to secure the permission without naming the target. They ask whether a role can `deploy`, `write`, or `admin`. The better first question is what the role can deploy, write, or administer. A permission without a target is like a filename without a directory. You know a name exists, but you do not know where it points.

## Workflow Boundaries

GitHub Actions workflows are a good place to learn delivery trust because the boundary is visible in YAML. The file is short, but it carries several security decisions: which event starts the workflow, which permissions the token receives, which job can request cloud identity, and which environment gates a deployment.

Here is a small baseline workflow for the orders service.

```yaml
name: orders-api-delivery

on:
  pull_request:
    branches: ["main"]
  push:
    branches: ["main"]

permissions:
  contents: read

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: "npm"
      - run: npm ci
      - run: npm test

  deploy-prod:
    needs: test
    if: github.ref == 'refs/heads/main'
    environment: production
    permissions:
      contents: read
      id-token: write
      packages: read
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/login-cloud-oidc.sh
      - run: ./scripts/deploy-prod.sh
```

The `on` block tells you which events can start the workflow. Pull requests and pushes to `main` both run it, but that does not mean both events receive the same power. The top-level `permissions` block gives the default `GITHUB_TOKEN` read-only access to repository contents. That is the safe baseline for jobs that only need to check out code and run tests.

The `test` job runs on pull requests and pushes. It checks out code, installs dependencies, and runs tests. It does not ask for `id-token: write`, so it cannot request an OIDC token from GitHub's identity provider. It does not name the `production` environment, so it cannot receive environment secrets or pass production deployment rules.

The `deploy-prod` job is narrower and more powerful at the same time. It runs only when the ref is `refs/heads/main`. It names the `production` environment, which lets GitHub apply environment protection rules before the job proceeds. It asks for `id-token: write` because the deploy script needs to exchange a short-lived OIDC token for a cloud token. It asks for `packages: read` because it reads the image from the registry.

The first tradeoff is about where power belongs. Each job needs the permission that matches its job, and the more powerful jobs need stronger boundaries around their triggers, source code, environments, and tokens.

The dangerous workflow shape looks similar at first glance.

```yaml
on:
  pull_request_target:
    branches: ["main"]

permissions: write-all

jobs:
  test-and-publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ github.event.pull_request.head.sha }}
      - run: npm ci
      - run: npm test
      - run: npm publish
```

The important fields are `pull_request_target`, `write-all`, the checkout `ref`, and `npm publish`. The event runs in the context of the base repository. The token is broad. The checkout step pulls untrusted pull request code into that trusted context. The final step publishes from the same job. A reviewer reading this file should stop at the boundary: untrusted code and trusted publishing power have met in one job.

The fix is usually structural. Keep untrusted pull request validation separate from trusted publishing and deployment. If a job runs code from a fork or untrusted branch, treat its workspace, cache, scripts, dependency lifecycle hooks, and generated files as untrusted. If a job can publish, deploy, or request cloud identity, make its source, trigger, environment, and permissions easy to read.

## Artifacts and Provenance

An artifact is the thing the delivery system produces and hands to the next system. In a Node service, the artifact may be a package tarball. In a containerized service, it is usually an image digest. In infrastructure work, it may be a Terraform plan. In Kubernetes work, it may be a rendered manifest and the image digest inside it.

The digest matters because names can move. A tag like `latest` or `prod` is a label. It can point to a different image later. A digest points to specific content.

```text
Image name: ghcr.io/devpolaris/orders-api
Tag:        main-8f2a91d
Digest:     sha256:4e1b9f30d4a97a7f5c3f4c7f1f3a0f2c9e86b4d4a4e4d0a9a3f0e1c2b7c8d9a0
Built from: 8f2a91d4c0b8
Workflow:   orders-api-delivery #1842
Builder:    github-hosted-runner
```

Read this record carefully. The image name tells you where the artifact lives. The tag tells you the human-friendly release label. The digest is the immutable reference. The commit tells you which source produced it. The workflow run tells you which automation created it. The builder tells you where the build ran.

Provenance is the signed or recorded statement that connects those facts. It answers questions like these:

- Which source repository and commit started the build?
- Which workflow or build system produced the artifact?
- Which build parameters were used?
- Which artifact digest came out?
- Which identity made the statement?

Provenance does not remove the need for judgment. It gives judgment better facts. If a production incident starts with "which code is running?", a digest and provenance record let the team answer without guessing. If a package appears in the registry but the provenance points to an unexpected workflow, the team has a reason to stop and investigate before deploying it.

There is a practical catch. Provenance is only as useful as the boundary around the builder. If an attacker can make the trusted builder run attacker-controlled code with publishing permissions, the resulting artifact can still carry a trustworthy-looking record. This is why the workflow boundary from the previous section matters. Artifact evidence and workflow trust reinforce each other.

## Case Study: XZ Utils

In March 2024, the open source community found a backdoor in XZ Utils, a widely used compression library. The issue was assigned CVE-2024-3094. The affected upstream versions were `5.6.0` and `5.6.1`, and the risk mattered because the library sits low in the Linux software stack. A small library can become part of many systems that never think about compression directly.

For this article, the important lesson is not every technical detail of the backdoor. The important lesson is the trust path. A downstream Linux distribution does not read every line of every dependency from scratch. It depends on maintainers, release artifacts, build scripts, package maintainers, distribution testing, and user reports. The XZ case showed how a trusted path can be attacked through social trust, release process, and build behavior.

Here is a simplified trust path for a dependency like XZ.

```text
source repository
  -> maintainer review
  -> release artifact
  -> distribution package
  -> operating system image
  -> production host
```

Each arrow is a handoff. The source repository hands code to the release process. The release process hands an artifact to package maintainers. The package lands in an operating system. The operating system lands on a production host. If any handoff accepts the wrong thing, the later systems may carry the risk even though they never made a direct security decision.

The case also shows why open source needs a delivery trust model around it. Open source gives inspection, community review, and shared response. The remaining questions are still concrete: whether release artifacts have been independently rebuilt and compared, whether maintainer accounts are healthy, whether unusual build steps are understood, who created the artifact, which process created it, who reviewed that process, and which evidence would show a mismatch.

Map the XZ lesson back to `devpolaris-orders-api`. The team may not maintain a compression library, but it still relies on packages, build tools, GitHub Actions, container base images, and cloud APIs. Each dependency enters the delivery tree somewhere. A package lockfile records a version. A build log records an install. An SBOM records what shipped. A scanner or audit trail may report a later problem. The team cannot make every dependency risk disappear, but it can know where dependencies enter, which artifact they reach, and how to replace them when the evidence changes.

## Evidence You Can Read

Evidence is any record that helps a human answer what happened. Good delivery evidence is small, boring, and specific. It does not need to be a long report. It needs to connect actor, permission, target, artifact, and result.

Here is one release evidence record for the orders service.

```text
Service:      devpolaris-orders-api
Environment:  production
Commit:       8f2a91d4c0b8
Pull request: #418
Approver:     maya-dev
Workflow:     orders-api-delivery #1842
Artifact:     ghcr.io/devpolaris/orders-api@sha256:4e1b9f30...
Cloud role:   orders-api-prod-deployer
Target:       orders-api-prod
Result:       health check /health returned 200
```

Every line earns its place.

`Service` and `Environment` name the production target. `Commit` and `Pull request` connect production back to source. `Approver` records the human approval. `Workflow` records the automation. `Artifact` records the exact thing that deployed. `Cloud role` records the machine identity that acted. `Target` records what changed. `Result` records whether the service came back healthy.

Now compare that with a weak record.

```text
Deploy completed.
```

That line is easy to write, but it answers almost nothing. Which service deployed? Which artifact? Which commit? Which actor? Which environment? Which identity? If a vulnerable dependency is announced the next day, the weak record cannot tell you whether production is affected. The stronger record can.

Logs are the same. A useful cloud audit event has a caller, action, resource, time, and result.

```json
{
  "time": "2026-05-19T10:42:31Z",
  "caller": "orders-api-prod-deployer",
  "action": "service.update",
  "resource": "orders-api-prod",
  "source": "github-actions/orders-api-delivery/1842",
  "result": "success"
}
```

The `caller` is the identity. The `action` is the permission being used. The `resource` is the target. The `source` ties the cloud event back to the workflow run. The `result` tells you whether the action succeeded. If your logs do not carry these fields, the first improvement is often to enrich the deployment script or cloud logging configuration so the next event is easier to explain.

## Where Trust Breaks

Delivery systems usually fail in repeated shapes. The names change, but the shape is familiar.

| Break | What it looks like | What to inspect first |
|-----------|--------------------|-----------------------|
| Source boundary break | Untrusted pull request code runs with trusted repository context | Workflow event, checkout ref, job permissions |
| Identity break | One token can publish, deploy, and change settings | Token scope, role policy, environment rules |
| Artifact break | Production runs a tag that no longer matches the reviewed build | Digest, registry event, deployment record |
| Dependency break | A transitive package or base image carries a new risk | Lockfile, SBOM, scanner finding |
| Evidence break | Nobody can connect a production change to source and actor | Audit log fields, release record, workflow run |
| Ownership break | Sensitive workflow or IAM changes merge without the right reviewer | CODEOWNERS, branch protection, review history |

The first column gives the kind of break. The second column gives the symptom. The third column tells you where to look before changing anything. This order matters. If a package is compromised, rotating cloud credentials may be necessary later, but the first question is which artifact included the package and where that artifact ran. If a deployment bypassed approval, the first question is which identity performed the change and why that identity could reach the target.

There is also a cost tradeoff in every fix. Pinning every third-party action to a full commit SHA improves immutability, but it creates update work. Narrowing a cloud role reduces blast radius, but it takes more design than one shared admin role. Keeping long audit retention helps investigations, but it costs money and needs a retrieval path. Requiring environment approvals protects production, but it slows urgent changes unless the emergency path is also designed.

The goal is explainable security. A junior engineer should be able to open the delivery tree, follow one production change, and say which human approved it, which workflow ran it, which identity acted, which artifact deployed, and which log proves the result.

## Putting It All Together

The first version of the orders delivery path looked simple: pull request, test, merge, deploy. That was enough to ship, but it was not enough to explain trust.

The delivery trust model adds names to the path. The pull request is the source boundary. The workflow event decides which context the job receives. The token and OIDC subject are identities. The image digest is the artifact. The environment and cloud role are deployment boundaries. The audit log and release record are evidence.

The XZ Utils case gives the same lesson at open source scale. A dependency reaches production through a chain of people, releases, build systems, packages, and downstream users. The chain is only reviewable when its handoffs leave evidence. That is the habit to carry into everyday DevSecOps work: do not start with a security product list. Start with the delivery path and ask what each step is allowed to trust.

For `devpolaris-orders-api`, the practical model is:

- Source changes need review and clear ownership.
- Untrusted code needs a separate workflow boundary.
- Powerful jobs need narrow permissions and protected environments.
- Artifacts need immutable references and provenance.
- Production changes need audit events that name caller, action, target, source, and result.
- Dependencies need a place in the evidence trail through lockfiles, SBOMs, scanners, and release records.

Once those pieces are visible, the later topics in this roadmap become easier. Least privilege is how you narrow actors, permissions, and targets. Secret management is how you avoid long-lived credentials in the path. Threat modeling is how you find broken boundaries before attackers do. Evidence and ownership are how the team proves what happened and improves the system after each change.

## What's Next

The next article turns this trust model into a review habit. A delivery tree tells you where trust moves. Threat modeling asks what could go wrong at each move, which failures are realistic, and which controls are worth adding first.

---

**References**

- [GitHub Actions secure use reference](https://docs.github.com/en/actions/how-tos/security-for-github-actions/security-guides/using-githubs-security-features-to-secure-your-use-of-github-actions) - GitHub explains third-party action risk, token exposure, and why pinning actions to full commit SHAs gives an immutable action reference.
- [GitHub Actions OpenID Connect](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect) - GitHub describes replacing long-lived cloud secrets with short-lived tokens exchanged through OIDC.
- [GitHub deployment environments](https://docs.github.com/en/actions/reference/deployments-and-environments) - GitHub documents environment protection rules, required reviewers, environment secrets, and deployment branch restrictions.
- [SLSA provenance specification](https://slsa.dev/spec/v1.0/provenance) - SLSA defines provenance as a statement connecting build inputs, build process, and produced artifacts.
- [OpenSSF: XZ Backdoor CVE-2024-3094](https://openssf.org/blog/2024/03/30/xz-backdoor-cve-2024-3094/) - OpenSSF summarizes the XZ Utils supply-chain compromise and the broader open source response.
- [NIST SP 800-218 Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - NIST provides high-level secure software development practices that map to delivery security, evidence, and risk reduction.
