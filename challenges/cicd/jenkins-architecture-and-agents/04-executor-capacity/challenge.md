---
retired: true
title: "Restore Capacity Without Oversubscribing"
sectionSlug: how-do-controllers-agents-executors-and-workspaces-fit-together
order: 4
revision: 3
---

## Current situation

Two independent quality checks share the Node fleet. Each Node worker has capacity for one heavy process; the second worker is currently disabled.

## The issue

The pipeline is sequential and the enabled worker cannot safely gain more executors. Increasing a slot count would not create memory or CPU.

## Your task

Enable the existing second Node worker in agent-settings.yaml and restructure Jenkinsfile so lint and unit tests overlap on distinct allocations. Build only after the checks join. Publish unit reports even when tests fail. Preserve the read-only application and scenario files.

## Success criteria

Healthy checks genuinely overlap and the archived build finishes within 35 seconds. The regression case still publishes reports and never builds. Neither controller execution nor counts above safeExecutors are accepted. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
