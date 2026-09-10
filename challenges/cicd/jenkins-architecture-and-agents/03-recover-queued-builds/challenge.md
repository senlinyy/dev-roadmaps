---
retired: true
title: "Recover a Queued Build"
sectionSlug: how-do-you-diagnose-architecture-failures
order: 3
revision: 3
---

## Current situation

The controller has spare machines, but checkout validation is waiting. agent-settings.yaml is an editable snapshot of the authored node settings; hardware capabilities and connection health remain fixed in the scenario.

## The issue

The assigned labels and enabled executor slots no longer expose usable Node capacity. Broadening the pipeline to any agent risks landing on an unsuitable worker.

## Your task

Inspect the node inventory, restore useful Node capacity through agent-settings.yaml, and split validation from packaging in Jenkinsfile. Keep controller executors at zero and preserve all nodes. Each worker's safeExecutors is a measured limit. Preserve the read-only application and scenario files.

## Success criteria

Lint, unit tests, application build, and archive finish within 45 simulated seconds on the normal fleet and when node-a loses its connection. A test regression prevents packaging. No controller work. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
