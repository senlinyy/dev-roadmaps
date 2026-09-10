---
retired: true
title: "Repair the Complete Production Authority Chain"
sectionSlug: how-does-the-complete-production-flow-fit-together
order: 8
revision: 3
---

## Current situation

A release audit finds broad token permissions, an unreviewed environment, loose cloud trust, and independently scheduled production work.

## The issue

A green deployment can bypass validation or originate from an untrusted identity.

## Your task

Repair the workflow, environment settings, and cloud trust together. Validate PRs without authority; release one artifact only after main validation and independent approval. Deny failed tests, forks, other repositories, and missing approval.

Edit the workflow and `cloud-trust.json`, `environment-settings.json`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: approved healthy main; failed validation; untrusted contributor; approval absent; wrong repository. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
