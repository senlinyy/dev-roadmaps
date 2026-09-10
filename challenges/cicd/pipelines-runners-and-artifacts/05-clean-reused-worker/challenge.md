---
retired: true
title: "Yesterday’s Worker Changes Today’s Result"
sectionSlug: how-do-controllers-and-runners-divide-responsibility
order: 5
revision: 1
---

## Current situation

A persistent Linux worker is reused for checkout tests. Authored starting states include stale generated files, a leftover application process, and a later test failure.

## The issue

Old build outputs and occupied service resources influence the next run. Successful-path cleanup alone leaves the next job exposed after failure.

## Your task

Repair preparation and teardown in pipeline.yaml. Keep the persistent worker model for this exercise, remove generated files and old processes before setup, construct a fresh installation and isolated test service, validate and build, then clean up on every exit. Preserve checked-in files.

## Success criteria

Clean and contaminated starting states both complete a current build. A genuine test failure still stops build. Each run ends without generated-file or process residue.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

fresh: false selects a reused worker. cleanup takes files and processes booleans and preserves repository files. finally runs after a failed check. Service start fails when an old process already occupies its modeled resource.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
