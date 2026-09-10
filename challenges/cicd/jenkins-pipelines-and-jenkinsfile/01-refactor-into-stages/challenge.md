---
retired: true
title: "Expose Meaningful Delivery Stages"
sectionSlug: how-should-stages-represent-state-transitions
order: 1
revision: 3
---

## Current situation

The checkout service runs on a Node agent. Its only stage builds and archives an application without showing whether the source has passed quality checks.

## The issue

A green package is currently possible without lint or tests, and the single stage hides the boundary between validation and packaging.

## Your task

Restructure Jenkinsfile into a validation stage and a later application-build stage. Use the same global Node allocation, perform a locked install, run both checks, and archive only the passing build. Preserve the read-only application and scenario files.

## Success criteria

Validation and packaging have distinct executed stages. Both checks precede exactly one build. Unit or lint regressions stop before any build or archive. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.
:::
