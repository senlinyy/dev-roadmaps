---
retired: true
title: "Give Integration Tests a Real Execution Contract"
sectionSlug: how-do-job-containers-and-service-containers-change-execution
order: 2
revision: 3
---

## Current situation

Integration tests need a Node container and a PostgreSQL service on an eligible worker.

## The issue

The workflow selects Windows and assumes an unconfigured database is already ready.

## Your task

Use the supplied node:24 image on Linux. Configure the postgres:17 service as postgres with pg_isready health checks; tolerate 12 seconds of startup, and never build after failed integration.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: database ready; database starts slowly; database never healthy. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
