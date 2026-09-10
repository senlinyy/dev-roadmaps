---
retired: true
title: "Route Work to Eligible Runner Capacity"
sectionSlug: how-do-labels-and-groups-select-runner-capacity
order: 4
revision: 3
---

## Current situation

Public validation and a protected release worker serve different purposes.

## The issue

A release label is misspelled and validation targets the trusted pool, leaving work queued and overexposed.

## Your task

Keep source validation on hosted Linux. Route the artifact-consuming release job to the production group using its full self-hosted/linux/release label set. Do not weaken the runner inventory.

Edit the workflow. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: correct pool is available; hosted windows is absent. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
