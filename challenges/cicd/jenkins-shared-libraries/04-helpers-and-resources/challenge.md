---
retired: true
title: "Keep Helpers and Resources Behind the API"
sectionSlug: why-are-src-and-resources-separate-from-vars
order: 4
revision: 3
---

## Current situation

Checkout wants one thin standardService entry point. Its library contains a packaged command helper and a unit-command resource.

## The issue

The global step executes before installing dependencies, the helper returns a lint command instead of building, and the resource points at packaging.

## Your task

Repair all three layers: vars owns checkout/install and execution order; src/com/acme/Commands.groovy supplies the build command; resources/com/acme/unit.txt supplies the unit command. Keep the consumer thin, run lint and tests before building, and archive the package. Preserve the read-only application and scenario files.

## Success criteria

One shared call executes lint and unit checks, then exactly one build and archive. A unit regression prevents the build. Helper and resource content come from the selected library snapshot. Run every supplied case, inspect the evidence, then select Check Run.

:::expand[Simulation format]{kind="note"}
This is a bounded Jenkins simulation, not a running controller or general Groovy interpreter. Cases reset independently. Unsupported syntax fails explicitly. Declarative stages, agent labels joined by && or ||, explicit-agent parallel branches, Boolean parameter gates, timeout and post behavior are supported. Workspace finalization with agent none belongs in stage post.

The command catalog is npm ci, npm run lint, npm test, npm run build, ./scripts/package.sh, and ./scripts/deploy.sh staging|production. Commands consume fixed fixtures, never execute. Generated paths are dist/app.json, dist/image.json and reports/unit.xml. stash/unstash, junit, archiveArtifacts, deleteDir and cleanWs use these simulated workspaces. Agent settings are an editable lab inventory snapshot, not a JCasC schema.

Library settings use the supplied lab registry. @Library resolves only catalog refs. vars files support def call(Map config), named options and a two-option Elvis fallback. libraryResource loads command text; the bounded src helper supports one imported static String method returning a literal. No arbitrary Groovy, classpath or CPS execution occurs.
:::
