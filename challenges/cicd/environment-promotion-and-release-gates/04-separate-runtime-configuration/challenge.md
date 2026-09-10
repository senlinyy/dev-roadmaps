---
retired: true
title: "Separate Runtime Settings from Release Bytes"
sectionSlug: how-does-runtime-configuration-stay-separate-from-the-artifact
order: 3
revision: 1
---

## Current situation

Orders API expects the orders-db database, shared sessions and orders cache namespace. Its secret reference is secret/orders-db. Those settings belong to runtime.yaml and the deployment invocation, not an environment-specific application rebuild. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The workflow uses preview settings, misses its secret reference, and selects a rebuilt package after staging. The environment label alone cannot prove runtime compatibility.

## Your task

Repair the runtime settings and secret injection, restore production-relevant parity, and design a complete same-digest staging-to-production sequence. Promote healthy green but hold a missing production approval. Do not edit release bytes or put secret values in the artifact.

Edit `deployment.yaml` and the supplied runtime/policy files only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Correctly configured release:** Runtime settings and independent approval can be satisfied. Required result: **deployed** on **green**.
- **Production approval absent:** Application configuration is valid, but production is not authorized. Required result: **held** on **blue**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. select chooses a retained release; attest verifies source and builder against authored provenance. stage takes config and parity YAML mapping filenames plus secret references. smoke verifies the staged bytes. authorize takes environment and actor; promote transfers the selected bytes unchanged. Changing selection invalidates earlier evidence. No build, registry access, signing service or production deployment runs.
:::
