---
retired: true
title: "Route Work by Capability"
sectionSlug: how-do-connections-labels-and-the-queue-select-an-executor
order: 2
revision: 3
---

## Current situation

The checkout service now builds JavaScript and packages a container on separate Jenkins agents. The inventory in .lab/scenario.json lists labels separately from installed tools.

## The issue

The current workflow sends both workloads to the same pool. An online agent is not necessarily capable of executing every step.

## Your task

Repair Jenkinsfile so validation and the application build use Node-capable Linux agents, then transfer the generated application to a Docker-capable agent for packaging. Do not rebuild the application on the packaging agent. Preserve the read-only application and scenario files.

## Success criteria

Both checks pass, one application build is transferred and packaged, and dist/image.json is archived. A unit regression blocks both builds. No workload uses the controller. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
