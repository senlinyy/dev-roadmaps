---
retired: true
title: "One Green Job, Missing Platform Coverage"
sectionSlug: how-do-dependencies-parallelism-and-evidence-shape-the-pipeline-graph
order: 4
revision: 1
---

## Current situation

The supported checkout library contract is Linux and Windows on Node 22 and 24. The existing workflow covers only Linux/24 and uses a Linux-only runner pool.

## The issue

A single green test does not establish compatibility with the other three supported combinations. Packaging can proceed without their evidence.

## Your task

Define the complete OS/runtime matrix, select compatible workers from the scenario catalog, and prepare each expanded job independently. Keep one packaging worker gated on the entire matrix. Do not remove combinations or make failures advisory.

## Success criteria

All four combinations execute in the healthy case, with one downstream build. An authored Windows/22 failure prevents packaging while the other matrix results remain visible.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

matrix contains nonempty os and runtime lists. setup runtime: matrix selects the expanded runtime. pool names come from scenario fixtures. A needs entry referencing a matrix waits for all expanded jobs.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
