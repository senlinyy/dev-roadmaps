---
retired: true
title: "Extract Validation Without Hiding Its Interface"
sectionSlug: how-do-composite-actions-expose-inputs-and-outputs
order: 1
revision: 3
---

## Current situation

Two callers are drifting in their setup and validation sequence. A local action tab is available for extraction.

## The issue

The action hard-codes Node 22, skips lint, and does not expose the revision it validated.

## Your task

Repair the composite action and caller together. Accept node as input, run locked lint/unit validation, expose the current revision, and consume that output in the caller.

Edit the workflow and `.github/actions/validate/action.yml`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: first caller; second caller revision; shared validation fails. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
