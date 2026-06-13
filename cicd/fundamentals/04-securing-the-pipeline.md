---
title: "Securing the Pipeline"
description: "Learn how CI/CD security gates catch leaked secrets, risky code, vulnerable dependencies, unsafe images, and untrusted artifacts before release."
overview: "A secure pipeline checks the code, dependencies, container image, credentials, and artifact identity before software reaches production. This article follows one service through those checks and shows how teams make the gates useful instead of noisy."
tags: ["security", "devsecops", "secrets", "provenance", "scanning"]
order: 4
id: article-cicd-fundamentals-securing-the-pipeline
aliases:
  - securing-the-pipeline
  - article-cicd-fundamentals-securing-the-pipeline
  - cicd/fundamentals/securing-the-pipeline.md
---

## Table of Contents

1. [Security Belongs Inside Delivery](#security-belongs-inside-delivery)
2. [What The Pipeline Protects](#what-the-pipeline-protects)
3. [Secrets In Source Control](#secrets-in-source-control)
4. [Secret Scanning And Short-Lived Credentials](#secret-scanning-and-short-lived-credentials)
5. [Static Code Scanning](#static-code-scanning)
6. [Dependency And License Checks](#dependency-and-license-checks)
7. [Container Image Scanning](#container-image-scanning)
8. [Software Bills Of Materials](#software-bills-of-materials)
9. [Signatures And Provenance](#signatures-and-provenance)
10. [Pipeline Permissions And Runner Boundaries](#pipeline-permissions-and-runner-boundaries)
11. [Triage Without Freezing Delivery](#triage-without-freezing-delivery)
12. [Putting It All Together](#putting-it-all-together)

## Security Belongs Inside Delivery
<!-- section-summary: A secure pipeline turns security checks into normal release steps, so risky changes fail before production. -->

A **CI/CD pipeline** is the automated path that turns a code change into something running for users. It usually checks out the source code, installs dependencies, runs tests, builds an artifact, stores that artifact, and deploys it to an environment. When the previous article talked about continuous delivery, the important idea was repeatability: the same release process should run the same way every time.

**Pipeline security** adds guardrails to that same path. The guardrails check whether the change carries leaked credentials, unsafe code patterns, vulnerable dependencies, risky container packages, and untrusted release artifacts. A secure pipeline treats those checks like unit tests. If a check finds a real release-blocking problem, the change stops before it becomes a production incident.

We will follow one service through the article. Imagine a team building `payflow-api`, a small payments API for an online store. The service is written in Node.js, built into a container image, pushed to a registry, and deployed to Kubernetes after a pull request merges into `main`. This is a normal production setup, and it gives us a clear way to connect each security concept to the previous one.

The secure path has several gates. The diagram below shows the order we will use as the service moves from pull request to production.

![Pipeline security gate chain showing code change, secrets, code scan, dependencies, image scan, SBOM, signature, deploy gate, and blocked risk](/content-assets/articles/article-cicd-fundamentals-securing-the-pipeline/security-gate-chain.png)

*A secure delivery path places the cheapest checks early, then verifies the built artifact before the deploy gate opens.*

Notice the order. We start with the secrets and source code because those checks can run as soon as someone opens a pull request. Then we move into dependencies because the application imports other people's code. After that, we inspect the container image because the release artifact includes operating system packages and build layers. Finally, we prove which workflow created the artifact before the deployment system accepts it.

## What The Pipeline Protects
<!-- section-summary: The pipeline protects more than application code because a release also includes dependencies, images, credentials, runners, and artifacts. -->

A **software supply chain** is every input and process that helps produce your running software. Source code is one part of it, but the full chain also includes package manager downloads, base container images, build scripts, GitHub Actions or Jenkins plugins, deployment credentials, build runners, artifact registries, and the final image digest that production pulls.

For `payflow-api`, the team writes the route handlers and business logic. The service also depends on packages such as an HTTP framework, a payment provider SDK, a logging library, and a JSON parser. The container image starts from a Node base image that already contains Linux packages. The pipeline itself uses reusable actions for checkout, login, testing, image builds, and deployment.

That means a clean application file can still produce a risky release. A dependency can contain a known vulnerability. A base image can include an outdated OpenSSL package. A build job can receive a cloud credential that reaches more resources than the deployment needs. A third-party action can change behavior after the team updates it. A compromised artifact can reach production if the deploy step trusts a tag like `latest` instead of a verified digest.

Security in the pipeline works because each check answers a different question. **Secret scanning** asks whether the change exposed credentials. **Static code scanning** asks whether the code contains dangerous patterns. **Software composition analysis** asks whether dependencies introduce known risk. **Image scanning** asks whether the built container contains vulnerable packages or misconfigurations. **SBOMs** record what went into the build. **Signatures and provenance** prove which workflow produced the artifact.

The first risk to handle is also the one that creates the fastest incident: a secret committed to source control. It deserves to come early because one leaked key can turn a simple pull request into an incident response.

## Secrets In Source Control
<!-- section-summary: A leaked secret gives someone else a working credential, so teams rotate it first and clean the repository second. -->

A **secret** is a value that proves identity or grants access. API keys, database passwords, private keys, cloud access tokens, webhook signing keys, package registry tokens, and OAuth client secrets all count. If someone copies a secret, they can often use it from another machine until the owner revokes or rotates it.

In the `payflow-api` team, a developer might test payment webhooks locally and paste a provider key directly into a config file during debugging. The code may look harmless during a rushed review because it sits beside normal configuration values. The dangerous part is that Git stores the value in the commit, and the value can remain in history after the team removes the visible line from the newest version.

```js
export const paymentConfig = {
  provider: "stripe",
  apiKey: "[redacted-example-live-key]",
  webhookSecret: "[redacted-example-webhook-secret]"
};
```

The recovery order matters. **Rotate the leaked credential first.** Rotation means creating a new credential, updating the real system to use the new value, and revoking the old value. Cleaning Git history has value, especially for public repositories and broad exposure, but the leaked value may already exist in clones, logs, screenshots, package caches, or attack tooling. The old credential should lose power before the team spends time rewriting commits.

After rotation, the team investigates where the secret appeared. They check the repository, CI logs, container layers, deployment manifests, and application configuration. A secret can leak through a failed build log as easily as through source code. Build tools sometimes print environment variables during debug mode, and a single `echo $PAYMENT_API_KEY` in a shell script can turn a protected secret into plain text in a job log.

This is why secret handling needs two layers. The first layer prevents secrets from entering source control. The second layer reduces the number of long-lived secrets the pipeline needs in the first place.

## Secret Scanning And Short-Lived Credentials
<!-- section-summary: Secret scanning blocks exposed credentials, while OIDC and narrow job tokens reduce how many permanent secrets exist in CI. -->

**Secret scanning** searches code, commits, pull requests, and sometimes push events for strings that look like credentials. Platforms such as GitHub can recognize many provider token formats, and teams can add custom patterns for internal keys. A custom pattern helps when a company has tokens like `payflow_live_...` that only its own systems understand.

**Push protection** moves secret scanning to the moment someone pushes code. That timing matters because it catches the leak before the bad commit lands in the remote repository. For a private company repository, this saves a lot of cleanup work. For a public repository, it can prevent a race where automated scanners on the internet find the token seconds after the push.

Secret scanning still has limits, so it works best with better credential design. A scanner can miss a secret if the value has an unusual format. It can also flag test fixtures or fake examples. Teams handle this by keeping fake values obviously fake, adding custom patterns for real internal secrets, and requiring a short reason when someone bypasses a secret alert.

The bigger improvement is using **short-lived credentials** for deployment. In GitHub Actions, **OpenID Connect**, usually shortened to **OIDC**, lets a workflow ask a cloud provider for a temporary token during a job. The workflow proves facts such as repository, branch, workflow, commit, and environment. The cloud provider checks those facts against a **trust policy**, which is a rule that says which workflow identities may receive a cloud role, and then issues a token that expires automatically.

For `payflow-api`, this means the deployment job can request cloud access only when the workflow runs from `main` and targets the `production` environment. The repository no longer needs to store a permanent cloud access key as a CI secret. The credential exists for the job, and then it expires.

```yaml
name: release

on:
  push:
    branches:
      - main

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v4
      - name: Request cloud credentials through OIDC
        run: ./scripts/cloud-login-with-oidc.sh
      - name: Deploy payflow-api
        run: ./scripts/deploy.sh
```

The important detail in that workflow is the `permissions` block. `contents: read` lets the job read the repository, and `id-token: write` lets the job request an OIDC token. Other permissions stay unavailable unless the workflow asks for them. In production, the cloud trust policy should also check the repository name, branch, environment, and **audience**, which is the intended receiver of the token. For example, an AWS role can require a token meant for AWS, from the `acme/payflow-api` repository, on the `main` branch, through the `production` environment, so a random workflow cannot borrow the production role.

The pipeline has reduced credential leaks and removed a permanent deployment key. The next check looks inside the application code itself, because a safe credential path still needs safe application behavior.

## Static Code Scanning
<!-- section-summary: Static code scanning reads source code before the app runs and points reviewers toward dangerous patterns. -->

**Static application security testing**, often shortened to **SAST**, analyzes source code without running the application. A SAST tool builds a picture of how data moves through the program and looks for patterns such as SQL injection, command injection, unsafe deserialization, hardcoded secrets, path traversal, and missing authorization checks.

In `payflow-api`, imagine a pull request that adds an admin endpoint for refunding orders. The code reads an `orderId` from the request and builds a SQL string by concatenating user input. Unit tests might pass because the happy path works. A static scanner can still flag the dangerous data flow: request input reaches a database query without parameterization.

```js
app.post("/admin/refunds", async (req, res) => {
  const query = "select * from payments where order_id = '" + req.body.orderId + "'";
  const payment = await db.query(query);

  res.json({ payment });
});
```

The safer version uses a parameterized query. Parameterization means the SQL engine receives the query shape and the value separately, so user input stays data instead of becoming executable SQL. A scanner can recognize that change and close the alert after the fix lands.

```js
app.post("/admin/refunds", async (req, res) => {
  const payment = await db.query(
    "select * from payments where order_id = $1",
    [req.body.orderId]
  );

  res.json({ payment });
});
```

On GitHub, CodeQL can run as a code scanning workflow and upload alerts to the repository. Other SAST tools can also upload results through SARIF, which is a standard format for static analysis results. The practical pattern is to start with a standard ruleset, block new high-confidence critical findings, and keep a separate cleanup plan for older alerts.

```yaml
name: code-security

on:
  pull_request:
  push:
    branches:
      - main

permissions:
  contents: read
  security-events: write

jobs:
  analyze:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: github/codeql-action/init@v3
        with:
          languages: javascript-typescript
      - uses: github/codeql-action/analyze@v3
```

SAST works best when developers can understand the alert quickly. A useful alert points to the source line, explains the data flow, and names the fix pattern. A vague alert that says "security issue found" will get ignored because the developer cannot connect it to a real behavior in the app.

Static scanning covers the code the team writes. The next risk comes from code the team imports, and that imported code often changes through small lock file updates.

## Dependency And License Checks
<!-- section-summary: Dependency checks catch vulnerable or disallowed packages before a pull request changes the application inventory. -->

**Software composition analysis**, usually shortened to **SCA**, inspects third-party packages and compares them with vulnerability advisories, package metadata, and sometimes license rules. For a Node service, it reads files such as `package.json` and `package-lock.json`. For Python it reads files such as `requirements.txt`, `pyproject.toml`, or lock files. The exact files change by ecosystem, but the idea stays the same.

This matters because modern services carry a lot of imported code. `payflow-api` may have a small source tree, but its dependency graph can include hundreds of direct and transitive packages. A **direct dependency** is one the team chooses, like an HTTP framework. A **transitive dependency** is pulled in by another package, like a tiny utility used by a logging library.

A dependency review gate looks at what a pull request changes. If the team updates a payment SDK and the lock file brings in a vulnerable transitive package, the pipeline can fail the check before the merge. This gives the developer a specific choice: upgrade to a patched version, choose a different package, or document a time-limited exception if the vulnerability does not affect the service.

```yaml
name: dependency-review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: read

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/dependency-review-action@v4
        with:
          fail-on-severity: high
          deny-licenses: GPL-3.0, AGPL-3.0
```

License checks belong in the same conversation. A package can be technically safe and still conflict with a company's license policy. The pipeline can warn or block when a pull request introduces a license that legal and engineering have already agreed to avoid. The goal is early visibility, because removing a package from a small pull request is much easier than replacing it after several teams depend on it.

Third-party CI actions and plugins deserve similar care. A workflow step such as `uses: some-owner/some-action@v1` downloads code into the runner and executes it during the job. Teams usually start with version tags for readability, then mature toward pinning important actions by full commit SHA and updating them through a review process. That way, the build does not silently execute new action code just because a tag moved or a maintainer account was compromised.

Dependency checks tell us about package manifests and lock files. Once the pipeline builds a container image, the release contains another layer of software: operating system packages and image metadata.

## Container Image Scanning
<!-- section-summary: Image scanning checks the built artifact, including operating system packages, language packages, secrets, and image configuration. -->

A **container image** is a packaged filesystem plus metadata used to start containers. It contains the application code, runtime, package manager files, operating system libraries, user settings, exposed ports, and every file copied during the build. The image becomes the thing production actually runs, so it needs its own security gate.

For `payflow-api`, the Dockerfile might start from a Node base image. That base image brings Linux packages with it. The application may also copy compiled assets, install production dependencies, and set runtime environment variables. A source scan can miss issues that only appear after those build steps complete.

**Image scanning** inspects the final image for known vulnerabilities, misconfigurations, embedded secrets, and sometimes license data. A scanner such as Trivy can read the image layers and report vulnerable OS packages and language dependencies. The report usually includes the package name, installed version, vulnerability identifier, severity, and fixed version when one exists.

```bash
trivy image \
  --severity HIGH,CRITICAL \
  --exit-code 1 \
  --ignore-unfixed \
  ghcr.io/acme/payflow-api:${GITHUB_SHA}
```

That command fails the job when the image contains high or critical vulnerabilities that have a fix available. The `--ignore-unfixed` choice keeps the first rollout from getting stuck on vulnerabilities the team cannot patch yet, but it should come with a separate review process. Some teams still track unfixed critical vulnerabilities in a dashboard so they can react as soon as an upstream fix appears.

Good image hygiene reduces the number of findings before scanning even runs. Multi-stage builds keep compilers and build tools out of the final image. Supported base images receive security updates. A non-root container user reduces the impact of a process escape or file write bug. Copying only the files the service needs avoids accidentally packaging `.env`, test fixtures, local caches, or SSH keys.

At this point the pipeline knows the source code, dependencies, and image look acceptable for release. The next question is more basic: what exactly did this release contain?

## Software Bills Of Materials
<!-- section-summary: An SBOM records the components inside a release so teams can search, audit, and respond quickly. -->

A **Software Bill of Materials**, usually shortened to **SBOM**, is a machine-readable inventory of software components and their relationships. For an application release, it can list package names, versions, package URLs, licenses, hashes, and dependency relationships. Common SBOM formats include CycloneDX and SPDX.

Think about a new vulnerability in a popular compression library. Without an SBOM, the security team has to search repositories, package manifests, containers, and deployment records to find affected services. With SBOMs stored beside releases, the team can ask a sharper question: which deployed artifacts include this component and version?

For `payflow-api`, the SBOM should be generated from the built artifact. The final image is what production runs, so the SBOM should include both application packages and image packages. Teams often attach the SBOM to the release, store it in an artifact registry, or link it through an **attestation**. An attestation is a signed statement about an artifact, such as "this image was built by this workflow" or "this SBOM belongs to this image digest."

```bash
syft ghcr.io/acme/payflow-api:${GITHUB_SHA} \
  -o cyclonedx-json=payflow-api.sbom.cdx.json
```

An SBOM gives the team visibility. The security value appears when the organization uses it for vulnerability response, procurement review, license review, and release evidence. A stale SBOM from yesterday's build cannot answer questions about today's image, so SBOM generation belongs inside the release pipeline.

Now we have a record of what the artifact contains. The next step proves who built it and which process created it, because inventory and identity answer different release questions.

## Signatures And Provenance
<!-- section-summary: Signatures prove artifact integrity, and provenance explains which trusted build process created the artifact. -->

An **artifact signature** is a cryptographic proof attached to a release artifact such as a container image, binary, package, or archive. The signature lets a verifier check that the artifact matches what the signer approved. If someone changes the artifact after signing, verification fails because the digest no longer matches.

**Provenance** is information about how an artifact was built. It can include the repository, workflow file, commit SHA, build trigger, build environment, and builder identity. SLSA, pronounced "salsa", defines supply chain security levels and a provenance format that helps consumers understand the build process behind an artifact.

For `payflow-api`, the production deploy gate should care about more than the image tag. A tag such as `prod` can move. A digest such as `sha256:...` names exact content. A signature proves the expected identity signed that content. Provenance shows that the image came from the approved release workflow on the expected repository and branch.

GitHub artifact attestations and Sigstore-based tools such as Cosign support this style of release evidence. A common flow is: build the image, push it by digest, generate an attestation that links the digest to the workflow, and verify that attestation before deployment. The deploy system can then enforce policy such as "only images built by `acme/payflow-api/.github/workflows/release.yml` from `refs/heads/main` can run in production."

```bash
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp "https://github.com/acme/payflow-api/.github/workflows/release.yml@refs/heads/main" \
  ghcr.io/acme/payflow-api@sha256:exampledigest
```

This is the difference between trusting a registry tag and trusting a release process. A registry tag says where the image was stored. A verified signature and provenance record say which identity signed it and which build path produced it. Production should care about the build path because compromised build credentials, manual uploads, and unreviewed scripts can all produce artifacts that look normal at first glance.

![Provenance verification showing image digest, SBOM, signature, build provenance, trusted workflow, main branch, verifier, and production gate](/content-assets/articles/article-cicd-fundamentals-securing-the-pipeline/provenance-verification.png)

*Provenance verification checks the artifact digest, inventory, signature, and build path before production trusts the release.*

That brings us to the pipeline runtime itself. A signed artifact still carries risk if the workflow that signed it had too much permission, so the job environment needs the same care as the artifact.

## Pipeline Permissions And Runner Boundaries
<!-- section-summary: Secure pipelines give each job only the token, secret, runner, and environment access it needs. -->

A **runner** is the machine or container that executes pipeline jobs. A GitHub-hosted runner starts fresh for a job and disappears after it finishes. A self-hosted runner is managed by your organization, which means it can reach private networks and special tools, but it also needs isolation, patching, and cleanup.

Every job should receive the smallest useful set of permissions. In GitHub Actions, the `GITHUB_TOKEN` can read repository contents, create releases, write pull request comments, upload security events, and perform other repository operations depending on how permissions are configured. A test job usually needs read access. A deploy job might need OIDC token access. A release job might need package write access. Giving every job write-all access turns a small script injection into a repository takeover path.

```yaml
jobs:
  test:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm test

  publish:
    runs-on: ubuntu-latest
    needs: test
    environment: production
    permissions:
      contents: read
      packages: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
      - run: ./scripts/build-and-publish.sh
```

Notice how the test job has no package write permission and no OIDC token permission. If a malicious dependency tries to publish a package during `npm test`, the token does not have that power. The publish job gets stronger permissions, but it runs after tests and targets the protected `production` environment.

Protected environments add another useful boundary. A deployment environment can require reviewers, restrict which branches can deploy, and keep environment secrets away from untrusted jobs. For pull requests from forks, deployment secrets should stay unavailable because the code in the pull request has not earned that trust yet.

Self-hosted runners need extra care because they often sit near production networks. A self-hosted runner that handles untrusted pull request code should have no path to production credentials or internal services. Many teams separate runner pools by trust level: public pull request validation on disposable runners, internal build jobs on controlled runners, and production deployment on a tightly restricted runner group.

At this point the pipeline has many gates. The final skill is operating those gates so developers fix real problems instead of fighting the system.

## Triage Without Freezing Delivery
<!-- section-summary: Useful security gates block clear release risk, route lower-risk findings into queues, and keep exceptions visible. -->

A security gate needs a policy that developers can understand. A simple starting policy might block leaked secrets, critical SAST alerts with high confidence, high or critical dependency vulnerabilities with a fix available, critical image vulnerabilities with a fix available, unsigned production artifacts, and deployments from untrusted branches. The exact thresholds should match the product risk, but the team needs a written rule before the first noisy week.

Older findings need a different path from new findings. If a repository already has 300 medium SAST alerts, blocking every pull request will trap developers in old debt. A better rollout starts by blocking new critical findings while the team creates a backlog for existing issues. The gate then becomes a ratchet: new code cannot make the security position worse, and the team pays down the old issues in planned batches.

Exceptions should expire. Sometimes a vulnerable package has no patched version, or a scanner reports a false positive in generated code, or a production hotfix must move before a full refactor. An exception record should name the finding, owner, reason, compensating control, and expiration date. Permanent exceptions become invisible risk, so they need review.

Pipeline speed also matters. Secret scanning, dependency review, and core SAST checks belong in the pull request path because they give fast feedback. Deep DAST scans, broad container scans, and full repository analysis can run nightly or before release if they take longer. **Dynamic application security testing**, or **DAST**, tests a running application from the outside, so it often needs a deployed test environment and more time than a normal pull request job.

The operating rhythm should feel normal after a while. Developers see a clear failure, fix the source line or package version, and rerun the job. Security engineers watch trends, tune noisy rules, and review exceptions. Release managers gain evidence that the artifact passed the checks the company promised to run.

## Putting It All Together
<!-- section-summary: A secure pipeline checks identity, code, dependencies, images, inventory, and provenance before deployment. -->

Let's put `payflow-api` through the full path. A developer opens a pull request that changes refund handling. Secret scanning checks the diff and push data for exposed tokens. Code scanning looks for unsafe data flow in the new handler. Dependency review checks whether the lock file added vulnerable packages or disallowed licenses. Unit tests and integration tests still run because security gates complement normal quality gates.

After the pull request merges, the release workflow builds a container image. The image scanner checks the final image for vulnerable OS packages, language packages, secrets, and misconfigurations. The pipeline generates an SBOM from the image and stores it with the release artifacts. Then the workflow signs or attests to the image digest, using the workflow identity rather than a permanent signing secret sitting in the repository.

The production deployment gate verifies the evidence. It checks that the image digest has the expected signature, that provenance points to the approved release workflow, that the workflow ran from `main`, and that the deployment job used the production environment. The deploy job receives only the token and cloud permissions it needs through OIDC, and those credentials expire after the job.

![Secure pipeline summary showing pull request checks, merge, build image, image scan, SBOM, attest, verify, and production](/content-assets/articles/article-cicd-fundamentals-securing-the-pipeline/secure-pipeline-summary.png)

*A secure pipeline checks the pull request early, attaches evidence to the built image, and verifies that evidence before production.*

The result is a delivery system that can explain itself. If someone asks what code shipped, the artifact digest answers. If someone asks what packages shipped, the SBOM answers. If someone asks who built it, provenance answers. If someone asks how risky findings were handled, the pipeline logs and exception records answer.

This is the main idea behind securing the pipeline. Security becomes part of the release path instead of a separate meeting after the release path has already done its work. The checks run every time, close to the change, with enough evidence for developers to fix real problems and enough control to keep risky artifacts out of production.

---

**References**

- [GitHub secret scanning](https://docs.github.com/en/code-security/concepts/secret-security/secret-scanning) - Explains secret scanning, supported repository coverage, and push protection concepts.
- [GitHub OpenID Connect](https://docs.github.com/en/actions/concepts/security/openid-connect) - Describes short-lived cloud tokens for GitHub Actions workflows and the claims cloud providers can validate.
- [GitHub workflow permissions](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#permissions) - Documents how workflows and jobs control the permissions granted to `GITHUB_TOKEN`.
- [GitHub code scanning](https://docs.github.com/en/code-security/concepts/code-scanning/code-scanning) - Explains code scanning, CodeQL, SARIF uploads, and pull request security feedback.
- [GitHub dependency review](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-review) - Documents dependency review, dependency diffs, vulnerability data, and enforcement through pull request checks.
- [Trivy container image scanning](https://trivy.dev/docs/latest/target/container_image/) - Documents scanning container image files and metadata for vulnerabilities, misconfigurations, secrets, and licenses.
- [CycloneDX SBOM capability](https://cyclonedx.org/capabilities/sbom/) - Defines SBOM use cases for component inventory, dependency relationships, vulnerability management, and license visibility.
- [SLSA provenance](https://slsa.dev/spec/v1.0/provenance) - Defines provenance as an attestation that links build artifacts to a build platform and build definition.
- [GitHub artifact attestations](https://docs.github.com/en/actions/concepts/security/artifact-attestations) - Explains signed provenance, artifact verification, SBOM association, and Sigstore-backed attestations.
- [Sigstore Cosign container signing](https://docs.sigstore.dev/cosign/signing/signing_with_containers/) - Documents signing, verifying, and attesting container images with Cosign.
- [OWASP Top 10 CI/CD Security Risks](https://owasp.org/www-project-top-10-ci-cd-security-risks/) - Lists common CI/CD risks including poisoned pipeline execution, weak credential hygiene, dependency chain abuse, and improper artifact integrity validation.
- [NIST Secure Software Development Framework](https://csrc.nist.gov/pubs/sp/800/218/final) - Provides secure software development practices for reducing software vulnerability risk.
