---
retired: true
title: "Parallel Checks With a Real Join"
sectionSlug: how-do-parallel-branches-options-and-post-change-execution
order: 6
revision: 3
---

## Current situation

Lint and unit tests are independent, and the fleet has two Node executors. The existing Jenkinsfile runs them one after another.

## The issue

Feedback is slower than necessary. Starting packaging alongside the checks would be faster but could release an unvalidated build.

## Your task

Give lint and unit tests independent parallel stage allocations and their own locked installations. Publish unit reports on failure, join both branches, then build/archive only after the join succeeds. Preserve the read-only application and scenario files.

## Success criteria

Healthy checks overlap and packaging completes within 35 seconds. A unit failure still produces its report and blocks packaging. No assumption of shared dependencies across allocations. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
