---
retired: true
title: "Carry the Build Across an Agent Boundary"
sectionSlug: how-do-agents-and-filesystems-affect-stages
order: 2
revision: 3
---

## Current situation

Validation and application compilation happen on a Node agent. A later image-packaging stage has a Docker agent with its own filesystem.

## The issue

The later stage assumes the earlier stage's output follows it. A fresh checkout contains source, not the generated application package.

## Your task

Repair both stages and the transfer between them. Run lint and unit checks, build once, stash the application, then unstash and package those bytes on Docker capacity. Archive the resulting image record. Preserve the read-only application and scenario files.

## Success criteria

One passing application build crosses the workspace boundary through the application stash. Image packaging and archive succeed; a unit regression creates neither package. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
