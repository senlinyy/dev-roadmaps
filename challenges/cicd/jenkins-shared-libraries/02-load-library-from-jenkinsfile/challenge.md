---
retired: true
title: "Load a Reviewed Library Contract"
sectionSlug: how-do-jenkins-configure-and-load-a-library
order: 2
revision: 3
---

## Current situation

The library registry and Jenkinsfile refer to different names and versions. The supplied v1 and v2 snapshots use different option names.

## The issue

A moving reference selects a breaking API, while the wrong registered name prevents loading. Fixing only the annotation leaves untested caller behavior.

## Your task

Align library-settings.yaml with company-pipeline, make v1.4.2 the stable default, and select that reviewed version in Jenkinsfile. Invoke its command interface for both quality checks and keep packaging behind them. Do not edit the supplied snapshots. Preserve the read-only application and scenario files.

## Success criteria

Both checks and the archive succeed using v1.4.2 even when main resolves to v2.0.0. A unit regression blocks packaging. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Library settings use the supplied lab registry. @Library resolves only catalog refs. vars files support def call(Map config), named options and a two-option Elvis fallback. libraryResource loads command text; the bounded src helper supports one imported static String method returning a literal. No arbitrary Groovy, classpath or CPS execution occurs.
:::
