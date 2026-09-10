---
retired: true
title: "Move Build Pressure Off the Controller"
sectionSlug: why-separate-orchestration-from-execution
order: 6
revision: 3
---

## Current situation

The Jenkins UI stalls whenever checkout releases run. The built-in node exposes two executors, and the pipeline explicitly requests that node.

## The issue

Application installs and build processes compete with the controller that holds scheduling and durable Jenkins state. Changing just the label leaves the unsafe fallback capacity available.

## Your task

Set the built-in node's executor count to zero in agent-settings.yaml. Restructure Jenkinsfile into Node validation/build and Docker packaging allocations with an explicit artifact transfer. Preserve the remaining workers. Preserve the read-only application and scenario files.

## Success criteria

Validation, transfer, packaging, and archive succeed without controller work; a failed test prevents packaging. The declared built-in node retains zero executors. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
