---
id: article-cicd-production-ci-workshop
title: "Production CI Workshop"
description: "Worked production delivery patterns, complete reference files and explicit operational verification."
order: 5
tags: ["cicd", "fundamentals", "production-workflows"]
---

## Table of Contents

1. [Reproduce the build on a clean runner](#reproduce-the-build-on-a-clean-runner)
2. [Isolate integration-test databases](#isolate-integration-test-databases)
3. [Move expensive packaging behind independent checks](#move-expensive-packaging-behind-independent-checks)
4. [Preserve failures and their diagnostic reports](#preserve-failures-and-their-diagnostic-reports)
5. [Test the runtime image rather than the source tree](#test-the-runtime-image-rather-than-the-source-tree)
6. [Make vulnerability policy explicit and reviewable](#make-vulnerability-policy-explicit-and-reviewable)
7. [Check Your Answers](#check-your-answers)
8. [References](#references)

This implementation chapter connects the earlier CI concepts to an actual small repository. Orders uses Node 22, project-local TypeScript, the Node test runner and PostgreSQL. Its HTTP fixture intentionally exposes only readiness, version and an orders response; the database test and worker have their own contracts. A clean build, successful test process and healthy packaged application are separate pieces of evidence. Keep those distinctions when reviewing a green workflow.

This chapter answers four connected questions:

- What makes the build reproducible?
- How does test failure remain observable?
- Which artifact should we test?
- What does the security gate establish?

### Before running the examples

The linked editor workspaces contain full independent starting snapshots and reference solutions. Local editing and self-review create no infrastructure. Use disposable repositories and isolated training accounts for optional live verification; configure credentials outside source control, budget for cloud resources, and remove only resources you created after collecting evidence. Do not run recovery scripts against an existing production system.

Install Node 22 and Docker for optional local checks. PostgreSQL integration requires a disposable database and psql. The committed lockfile is a real npm lockfile; installing dependencies requires network access unless the package cache is populated.

Action references are immutable reviewed commits in the challenge fixtures. Container and tool versions remain explicit operating assumptions: resolve approved digests and test compatibility before deployment rather than copying mutable tags into a production policy.

## Reproduce the build on a clean runner

A job starts with the runner image, not the developer's shell profile. setup-node selects the runtime; npm ci checks manifest/lockfile agreement and installs the locked dependency graph. npm scripts resolve project-local executables, so build should invoke tsc through npm rather than an absolute global path. Cache downloads to reduce network work, but keep installation mandatory on every independent runner.

The operational question is whether the repaired system can demonstrate all of the following:

- A clean checkout installs from the existing lockfile and runs lint, tests and compilation.
- No developer files, global compiler or restored node_modules are required.
- Changing a manifest dependency without updating the lockfile fails installation.

Here is the central implementation file, `.github/workflows/ci.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm test
      - run: npm run build
```

In a disposable checkout with Node 22, run `npm ci && npm run lint && npm test && npm run build`. Change only the manifest compiler version, rerun `npm ci`, and confirm a nonzero exit; restore the manifest afterward.

[Open the reproduce the build on a clean runner challenge](/challenges/cicd/production-ci-workshop?step=f1-clean-runner).

## Isolate integration-test databases

A PostgreSQL service container belongs to one job. A job running on the host reaches its published port through localhost; a containerized job instead uses the service hostname. Readiness is separate from process creation. ON_ERROR_STOP turns SQL errors into failed steps, and transaction rollback in a test keeps test data isolated within that database.

The operational question is whether the repaired system can demonstrate all of the following:

- Each job uses a fresh PostgreSQL instance with explicit readiness.
- Migrations and test assertions run against that job's database.
- A bad migration fails CI without touching staging.

Here is the central implementation file, `.github/workflows/integration.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```yaml
name: Integration
on: [pull_request]
permissions:
  contents: read
jobs:
  integration:
    runs-on: ubuntu-24.04
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_USER: orders
          POSTGRES_PASSWORD: test-only
          POSTGRES_DB: orders
        ports: ['5432:5432']
        options: >-
          --health-cmd pg_isready
          --health-interval 5s
          --health-timeout 3s
          --health-retries 10
    env:
      DATABASE_URL: postgres://orders:test-only@localhost:5432/orders
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: sudo apt-get update && sudo apt-get install -y postgresql-client
      - run: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/001-orders.sql
      - run: npm run integration
```

Run two pull requests concurrently. Both integration jobs must pass without staging credentials. Introduce invalid SQL in a disposable branch; migration must fail before tests. GitHub cleans up its service containers when jobs finish.

[Open the isolate integration-test databases challenge](/challenges/cicd/production-ci-workshop?step=f2-isolated-database).

## Move expensive packaging behind independent checks

Jobs express dependencies; steps express local sequence. A matrix expands independent checks while needs gates packaging on their aggregate result. Each consumer must materialize its inputs. A cache accelerates recomputation; a named artifact is the output another job deliberately consumes.

The operational question is whether the repaired system can demonstrate all of the following:

- Lint and unit tests can run independently.
- Packaging requires both checks to succeed.
- The consumer downloads the named archive and verifies its contents.

Here is the central implementation file, `.github/workflows/ci.yml`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```yaml
name: CI
on: [pull_request]
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-24.04
    strategy:
      fail-fast: false
      matrix:
        command: ['npm run lint', 'npm test']
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: ${{ matrix.command }}
  package:
    needs: checks
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262
      - uses: actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020
        with:
          node-version: '22'
          cache: npm
      - run: npm ci
      - run: npm run build && tar -czf orders.tar.gz dist
      - uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02
        with:
          name: orders-package
          path: orders.tar.gz
          if-no-files-found: error
  inspect:
    needs: package
    runs-on: ubuntu-24.04
    steps:
      - uses: actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093
        with:
          name: orders-package
      - run: tar -tzf orders.tar.gz | grep -Fx 'dist/server.js'
```

Introduce a lint syntax failure and verify that package and inspect do not run. On a healthy run inspect must execute on a new runner, download orders-package and find dist/server.js.

[Open the move expensive packaging behind independent checks challenge](/challenges/cicd/production-ci-workshop?step=f3-feedback-graph).

## Preserve failures and their diagnostic reports

A shell pipeline normally reports the last command's exit status; pipefail preserves failure from the test process when tee succeeds. Diagnostic publication should run after failure, but the product build should retain its normal success condition. always() belongs on evidence collection, not on release jobs.

The operational question is whether the repaired system can demonstrate all of the following:

- A failing test yields a nonzero wrapper exit and failed CI job.
- The failure run retains its JUnit report and console log.
- Compilation does not run after failed tests.

Here is the central implementation file, `scripts/test-ci.sh`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```bash
#!/usr/bin/env bash
set -euo pipefail
mkdir -p reports
node --test --test-reporter=spec --test-reporter-destination=stdout --test-reporter=junit --test-reporter-destination=reports/junit.xml test/unit.test.mjs 2>&1 | tee reports/test.log
```

Temporarily make one real assertion fail. Run `bash scripts/test-ci.sh`; check its nonzero exit and both report files. In GitHub, confirm report upload runs but compilation is skipped.

[Open the preserve failures and their diagnostic reports challenge](/challenges/cicd/production-ci-workshop?step=f4-failed-check-evidence).

## Test the runtime image rather than the source tree

Compiling source and successfully starting the final image answer different questions. Multi-stage builds separate compiler dependencies from runtime bytes. The smoke harness discovers a dynamically allocated local port, retries startup for a bounded period and cleans up on both paths. It verifies a small HTTP contract, not database or full business correctness.

The operational question is whether the repaired system can demonstrate all of the following:

- The final image runs as a non-root user and contains compiled runtime files.
- Smoke tests start the same local image that will be published.
- A broken entrypoint fails smoke verification and removes the test container.

Here is the central implementation file, `Dockerfile`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```dockerfile
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build
FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/package.json ./package.json
USER node
EXPOSE 3000
CMD ["node","dist/server.js"]
```

Build with Docker and run `IMAGE=orders:review bash scripts/smoke.sh` after tagging the build orders:review. Restore the broken entrypoint in a separate build and confirm failure plus container cleanup.

[Open the test the runtime image rather than the source tree challenge](/challenges/cicd/production-ci-workshop?step=f5-test-release-image).

## Make vulnerability policy explicit and reviewable

A release policy must state which severity and exception rules apply. SBOM generation inventories components; it does not establish that no vulnerabilities exist. Scan a digest so the result is tied to bytes. An exception needs a real finding ID, rationale, accountable owner and expiry; the default policy grants none. Store reports even when the gate fails, and treat scanner failure as inability to establish safety.

The operational question is whether the repaired system can demonstrate all of the following:

- Blocking findings produce a failed gate.
- JSON scan results and an SBOM are retained on failure.
- Exceptions require an identified vulnerability, owner, reason and future expiry; none are silently preapproved.

Here is the central implementation file, `scripts/scan.sh`. The linked workspace contains the remaining files, fixed fixtures and complete reference answer.

```bash
#!/usr/bin/env bash
set -euo pipefail
: "${IMAGE:?Set registry image by digest}"
[[ "$IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]
mkdir -p reports
trivy image --format cyclonedx --output reports/sbom.cdx.json "$IMAGE"
trivy image --ignorefile .trivyignore.yaml --severity HIGH,CRITICAL --format json --output reports/vulnerabilities.json --exit-code 1 "$IMAGE"
```

On a runner with the approved Trivy distribution, run the script for known healthy and vulnerable fixture images. Publish reports with an always-running artifact step in the surrounding workflow. Review a proposed exception separately; do not fabricate a vulnerability ID to obtain a green run.

[Open the make vulnerability policy explicit and reviewable challenge](/challenges/cicd/production-ci-workshop?step=f6-security-policy).

## Check Your Answers

:::expand[What makes the build reproducible?]{kind="recap"}

A fresh checkout uses an explicit runtime and project-local tools installed through the committed lockfile; cached downloads do not replace installation.

:::

:::expand[How does test failure remain observable?]{kind="recap"}

Preserve the failing exit status and publish diagnostics even when the test fails, while leaving packaging blocked.

:::

:::expand[Which artifact should we test?]{kind="recap"}

Start the actual packaged image and test its runtime contract rather than assuming source tests prove the final image works.

:::

:::expand[What does the security gate establish?]{kind="recap"}

The digest meets the stated vulnerability policy or has explicitly reviewed exceptions; an SBOM alone does not establish this.

:::

## References

- [Official implementation reference 1](https://docs.npmjs.com/cli/v11/commands/npm-ci)
- [Official implementation reference 2](https://docs.github.com/en/actions/tutorials/use-containerized-services/create-postgresql-service-containers)
- [Official implementation reference 3](https://docs.github.com/en/actions/how-tos/write-workflows/choose-what-workflows-do/pass-job-outputs)
- [Official implementation reference 4](https://www.gnu.org/software/bash/manual/html_node/Pipelines.html)
- [Official implementation reference 5](https://nodejs.org/api/test.html)
- [Official implementation reference 6](https://docs.docker.com/build/building/multi-stage/)
- [Official implementation reference 7](https://trivy.dev/latest/docs/configuration/filtering/)
