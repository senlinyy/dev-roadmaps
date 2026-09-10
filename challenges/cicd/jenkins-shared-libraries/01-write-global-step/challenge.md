---
retired: true
title: "Build a Useful Shared Check API"
sectionSlug: how-do-vars-become-the-pipeline-facing-api
order: 1
revision: 3
---

## Current situation

Checkout's lint and unit stages repeat checkout and dependency setup. A new vars/standardCheck.groovy wrapper exists, but consumers lack a stable interface.

## The issue

The wrapper ignores its caller and builds an application instead. Sharing it would spread the defect.

## Your task

Repair the global step to prepare its allocation and run the command supplied by the caller. Replace duplicated mechanics in Jenkinsfile with named command inputs for lint and unit tests. Keep packaging downstream, outside the shared check API. Preserve the read-only application and scenario files.

## Success criteria

Two shared calls run the requested checks, followed by one archived application build. A unit regression stops at its failing check. Unknown or missing API options fail explicitly. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Library settings use the supplied lab registry. @Library resolves only catalog refs. vars files support def call(Map config), named options and a two-option Elvis fallback. libraryResource loads command text; the bounded src helper supports one imported static String method returning a literal. No arbitrary Groovy, classpath or CPS execution occurs.
:::
