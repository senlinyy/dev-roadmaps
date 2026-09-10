---
retired: true
title: "Keep Failure Evidence Before Cleanup"
sectionSlug: how-do-parallel-branches-options-and-post-change-execution
order: 3
revision: 3
---

## Current situation

The current stage runs tests, publishes their report, and cleans up as ordinary sequential steps. The same workspace is reused by later builds.

## The issue

When tests return a failure, Jenkins stops normal steps before publication and cleanup. The failed run loses the evidence needed to diagnose it.

## Your task

Move reliable finalization into stage post behavior. Run lint and unit tests, build/archive only a healthy application, publish the generated XML on both result paths, and clean only after reporting. Preserve the read-only application and scenario files.

## Success criteria

The regression remains a failed pipeline while its test report is published. No build follows failed tests. Both healthy and failed runs leave a clean workspace, with reporting before final cleanup. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
