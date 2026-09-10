---
retired: true
title: "Give Only the Publisher a Credential"
sectionSlug: how-do-jenkins-credentials-store-and-transfer-authority
order: 1
revision: 3
---

## Current situation

Checkout has a dummy registry-publish secret-text credential scoped to the trusted main job. The publisher consumes PUBLISH_TOKEN from its environment.

## The issue

The draft binds credentials around dependency installation and tests, then publishes without a distinct release boundary. Application code receives power it does not need.

## Your task

Keep checkout, locked installation, lint, unit tests and one build on unprivileged Node capacity. Transfer the application into a main-only trusted release allocation. Bind registry-publish as PUBLISH_TOKEN only around the supplied publisher; never pass secret text as a command argument. Preserve the read-only application and scenario files.

## Success criteria

Healthy main publishes the validated bytes and removes the binding. PRs validate without credential access. Missing credentials fail closed. No sensitive exposure or active binding remains. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Credentials are dummy references. withCredentials supports one string or file binding per block. The supplied publisher uses ./scripts/publish.sh with a bound environment token, or a quoted file-variable argument for file bindings. dir models the temporary-file visibility boundary around publisher operations, not a general shell working directory. aws sts get-caller-identity evaluates the authored issuer/audience/job and the two role-policy files; no token is signed and no AWS API is called. Only explicit single-statement trust and ecs:UpdateService policies are modeled.
:::
