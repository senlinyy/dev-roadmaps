---
retired: true
title: "Keep Cache Hits Out of the Correctness Contract"
sectionSlug: how-do-setup-actions-caches-and-artifacts-cross-runner-lifecycles
order: 5
revision: 3
---

## Current situation

The workflow restores a dependency cache to speed up repeated validation.

## The issue

Its broad key restores node_modules across runtimes, and cache hits bypass installation.

## Your task

Cache npm downloads using OS, Node 24, and lockfile identity. Always run npm ci. Tests and build must work with an empty, current, or stale cache.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: cache absent; current cache; earlier cache. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
