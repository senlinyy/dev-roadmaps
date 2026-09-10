---
retired: true
title: "Separate PR Proof From Release Power"
sectionSlug: how-should-pull-request-and-release-paths-be-separated
order: 5
revision: 3
---

## Current situation

One multibranch definition currently sends every check to release-a, which has trusted release capability. A PR can change application scripts even when its Jenkinsfile is maintained separately.

## The issue

Running proposed code on a trusted release worker exposes that worker's authority. A late branch gate around publication cannot undo earlier execution.

## Your task

Move checkout, installs, lint, unit tests and compilation onto the unprivileged Node pool. Transfer one validated package to a separate trusted publish stage gated to main and not a change request. Bind only the publisher's credential, and retain test evidence/cleanup. Preserve the read-only application and scenario files.

## Success criteria

Main publishes once. Main-targeting PR and feature-branch cases execute quality checks without credential access or publication. No PR command runs on trusted capacity, and failed tests block releases. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Credentials are dummy references. withCredentials supports one string or file binding per block. The supplied publisher uses ./scripts/publish.sh with a bound environment token, or a quoted file-variable argument for file bindings. dir models the temporary-file visibility boundary around publisher operations, not a general shell working directory. aws sts get-caller-identity evaluates the authored issuer/audience/job and the two role-policy files; no token is signed and no AWS API is called. Only explicit single-statement trust and ecs:UpdateService policies are modeled.
:::
