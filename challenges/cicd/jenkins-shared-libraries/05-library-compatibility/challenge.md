---
retired: true
title: "Recover a Breaking Library Rollout"
sectionSlug: why-can-one-library-change-break-many-pipelines
order: 5
revision: 3
---

## Current situation

A library renamed command to task. An existing consumer still passes command; a migrating consumer already uses task. Both calls run here.

## The issue

The moving main ref distributed a breaking contract without a compatibility window. Migrating every caller immediately is not an available recovery strategy.

## Your task

Create a compatible v1.4.2 wrapper that accepts task and falls back to command. Both paths must prepare their allocation and execute the requested check. Pin Jenkinsfile to the reviewed snapshot, preserving both representative call shapes. Preserve the read-only application and scenario files.

## Success criteria

Old and new consumers work, including after main advances to incompatible v2. The unit regression still blocks packaging. Evidence reports v1.4.2 and two calls. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Library settings use the supplied lab registry. @Library resolves only catalog refs. vars files support def call(Map config), named options and a two-option Elvis fallback. libraryResource loads command text; the bounded src helper supports one imported static String method returning a literal. No arbitrary Groovy, classpath or CPS execution occurs.
:::
