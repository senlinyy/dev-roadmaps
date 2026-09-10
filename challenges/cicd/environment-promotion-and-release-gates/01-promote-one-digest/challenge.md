---
retired: true
title: "Promote the Bytes Staging Actually Tested"
sectionSlug: why-must-one-immutable-artifact-move-forward
order: 1
revision: 2
---

## Current situation

The registry contains green and a rebuilt artifact from the same source commit but a different build identity. Staging must validate green; production authorization names green, not the rebuild. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The current workflow stages one artifact, switches selection, and then promotes untested bytes. Runtime and parity settings also still reflect a developer environment.

## Your task

Repair the evidence chain from retained artifact selection through source/builder verification, representative staging, smoke checks and independent production authorization. Promote the unchanged staging digest and freshly verify production. Hold when staging smoke fails.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Tested artifact:** Green passes staging and has exact-candidate authorization. Required result: **deployed** on **green**.
- **Failed staging smoke:** Green fails its staged application check. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. select chooses a retained release; attest verifies source and builder against authored provenance. stage takes config and parity YAML mapping filenames plus secret references. smoke verifies the staged bytes. authorize takes environment and actor; promote transfers the selected bytes unchanged. Changing selection invalidates earlier evidence. No build, registry access, signing service or production deployment runs.
:::
