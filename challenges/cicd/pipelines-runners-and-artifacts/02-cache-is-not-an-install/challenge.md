---
title: "Works Only With a Warm Cache"
sectionSlug: how-do-caches-differ-from-artifacts
order: 2
revision: 1
---

## Current situation

The checkout pipeline reuses an installed tool directory and assumes it matches the current project. Run cases provide an empty cache, an exact cache, and an outdated cache.

## The issue

A cold worker has no tools, while an old cache can silently select the wrong versions. The pipeline treats optimization state as its source of correctness.

## Your task

Repair pipeline.yaml to select a cache using OS, runtime, and lock identity, then recreate the declared installation regardless of cache outcome. Validate lint and unit behavior before building and retain the package as an artifact. Do not change the manifest or lock.

## Success criteria

All three cache cases install the approved direct dependencies and publish a validated package. Only the compatible cache is a hit. Cache restoration never replaces locked installation; a hit reduces modeled install time.

:::expand[Simulation format]{kind="note"}
Bounded DevPolaris teaching YAML, not a provider workflow. No real commands, packages, credentials, or deployments run. Inspect `.lab/scenario.json` for the authored cases.

cache accepts key: [os, runtime, lock]. install mode locked reconstructs dependencies; cached consumes supplied old installation state. upload retains a built artifact. No packages are downloaded.

Run Pipeline tests all cases. Inspect the evidence, then Check Run.
:::
