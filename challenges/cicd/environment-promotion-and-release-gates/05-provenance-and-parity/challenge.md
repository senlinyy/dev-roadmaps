---
retired: true
title: "Verify Origin and Representative Staging"
sectionSlug: how-do-registry-boundaries-provenance-and-traceability-promote-without-rebuilding
order: 4
revision: 1
---

## Current situation

The trusted release source is commit-42 and its builder is ci-builder. Staging needs PostgreSQL 16, HTTPS and the expanded schema. One case contains green bytes whose recorded source is a different commit. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The initial workflow relies on a release name, stages against SQLite and HTTP, and carries no source-to-artifact verification into production.

## Your task

Rebuild the provenance and promotion sequence and correct the parity/configuration files. Deploy the intended artifact only when origin, representative staging health and independent authorization agree. Hold the unexpected-source case before promotion without changing its provenance fixture.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Trusted origin:** Green was built from the approved source. Required result: **deployed** on **green**.
- **Unexpected source:** Green records commit-99 rather than commit-42. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. select chooses a retained release; attest verifies source and builder against authored provenance. stage takes config and parity YAML mapping filenames plus secret references. smoke verifies the staged bytes. authorize takes environment and actor; promote transfers the selected bytes unchanged. Changing selection invalidates earlier evidence. No build, registry access, signing service or production deployment runs.
:::
