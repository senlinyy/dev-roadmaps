---
retired: true
title: "Separate Branch Trust from Environment Trust"
sectionSlug: how-do-id-token-write-environments-and-oidc-form-one-authority-chain
order: 5
revision: 3
---

## Current situation

A manually dispatched workflow has no environment and therefore presents branch-based identity.

## The issue

Its trust policy accepts every repository, and the release job grants write-all permissions.

## Your task

Use a branch-based subject for acme/checkout on main, check the STS audience, and narrow release permissions. Leave environment unset in this lab; different repos, feature refs, and PR identities must be denied by cloud trust.

Edit the workflow and `cloud-trust.json`. Preserve the read-only repository and scenario files.

## Success criteria

Run every supplied case: main branch identity; feature identity; different repository. Correct failure or filtering must stop the affected downstream work, not merely make a run green. Inspect logs, artifacts, and execution evidence before Check Run.

:::expand[Simulation format]{kind="note"}
GitHub Actions syntax with bounded interpretation, not a real runner. The read-only `.lab/scenario.json` lists event data, runner inventory, action references, and check outcomes. Settings/policy JSON files are explicit lab fixtures, not workflow syntax.

Only catalog actions and the shown npm/script operations are modeled; arbitrary shell commands, network access, containers, credentials, and cloud deployments do not execute. Expressions support context lookup, comparisons, Boolean operators, status functions, and exact-file hashFiles. Unknown operations fail explicitly.
:::
