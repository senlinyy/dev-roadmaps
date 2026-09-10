---
retired: true
title: "Unit Tests Pass, Integration Fails"
sectionSlug: what-does-a-ci-runner-actually-do
order: 6
revision: 1
---

## Current situation

The checkout service has lint, type, unit, and database integration fixtures. The current worker selects Node 22 and runs only unit tests before building.

## The issue

The Node 24 integration contract and isolated PostgreSQL dependency are missing. A unit-only green result does not establish that the application can talk to its database.

## Your task

Construct the complete validation environment and check sequence in pipeline.yaml. Use Node 24, locked dependencies, an isolated postgres-17 service, and observable readiness with a 30-second deadline. Run lint, types, unit, and integration before packaging; clean temporary files and processes on every exit.

## Success criteria

Healthy and 25-second service startup pass all four checks. Type and integration defects prevent build. An unhealthy service stops at its readiness boundary. Cleanup runs after success and failure.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

service takes name, image, isolated. wait takes service and timeout. check selects an authored check. finally runs report/cleanup even after failure; cleanup takes files and processes booleans.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
