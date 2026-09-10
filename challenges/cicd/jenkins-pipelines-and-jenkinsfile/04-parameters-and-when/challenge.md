---
retired: true
title: "Separate Validation From Release Intent"
sectionSlug: how-do-parameters-environment-and-when-select-a-path
order: 4
revision: 3
---

## Current situation

The same multibranch Jenkinsfile serves pull requests, main validation, and manually requested staging releases.

## The issue

The current workflow deploys every build. User intent, branch identity, and change-request context are not separate gates.

## Your task

Declare DEPLOY as a Boolean defaulting to false and TARGET_ENV defaulting to staging. Validate and build every case. Transfer the built application to a trusted release stage only for main, outside a change request, when DEPLOY is true. Preserve the read-only application and scenario files.

## Success criteria

PR, feature, and main-without-intent cases pass validation but have no deployment. Requested main deployment promotes the built bytes to staging. A regression never deploys. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
