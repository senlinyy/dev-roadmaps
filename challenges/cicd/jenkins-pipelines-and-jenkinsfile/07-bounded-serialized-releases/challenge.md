---
retired: true
title: "Bound Stalls and Serialize Releases"
sectionSlug: how-do-parallel-branches-options-and-post-change-execution
order: 7
revision: 3
---

## Current situation

A prior build of this same release job occupies deployment state until t=20. A separate fixture makes the unit test process stall for 120 simulated seconds.

## The issue

The current job has neither concurrency control nor a bounded validation stage. A second build can overlap a release, or hold an executor indefinitely.

## Your task

Serialize this job's builds, bound validation to 40 seconds, and clean its workspace even after timeout. Validate/build once and transfer the application into a later trusted staging deployment. Preserve the read-only application and scenario files.

## Success criteria

The healthy run waits for the previous build and deploys once. The stalled-test run times out, cleans up, and never builds or deploys. It ends within 65 seconds including the initial wait. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
