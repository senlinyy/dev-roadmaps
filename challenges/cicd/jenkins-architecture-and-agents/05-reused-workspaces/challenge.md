---
retired: true
title: "Make Reused Workspaces Predictable"
sectionSlug: when-should-agents-be-static-or-dynamic
order: 5
revision: 3
---

## Current situation

The Node agents are persistent. A previous job left an environment file and stale generated output; checkout restores tracked files but does not remove those leftovers.

## The issue

Identical application revisions now behave differently depending on which worker accepts the build. End-only cleanup also disappears when a test fails.

## Your task

Repair the workspace lifecycle in Jenkinsfile: begin from clean state, explicitly check out the scheduled revision, validate and build, archive the output, publish test evidence, and clean the allocation after either result. Preserve the read-only application and scenario files.

## Success criteria

Lint and tests run against clean state. The healthy run archives the new application; the failed-test run retains its report but does not build. Both runs finish with clean workspaces. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
