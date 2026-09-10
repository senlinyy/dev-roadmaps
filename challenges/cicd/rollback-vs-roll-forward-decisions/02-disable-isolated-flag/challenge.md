---
retired: true
title: "Contain an Isolated Feature Failure"
sectionSlug: when-is-the-best-recovery-not-a-deployment-rollback
order: 5
revision: 2
---

## Current situation

Green serves the contracted schema. Its new optional pricing path is controlled by a runtime feature flag. Blue is no longer schema-compatible. The ordinary failure disappears when the flag is disabled; another case has an unrelated application failure. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter routes users to the incompatible previous release and assumes the release version is the only recovery control.

## Your task

Keep the current artifact and disable the isolated feature, then freshly verify application health. Recover by mitigation in the flag-related case; hold the unrelated failure for incident escalation instead of claiming that switching a flag fixes every outage.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Isolated feature defect:** Disabling the optional feature restores health. Required result: **mitigated** on **green**.
- **Unrelated application defect:** The failure persists with the optional feature disabled. Required result: **held** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. recover selects a retained release, inspectCompatibility (boolean), and timeout seconds. mitigate supports disable-flag, pause-consumers or zero-traffic. inspect and verify have empty mappings. Compatibility uses the current schema, queued-message and session contracts; no action rewrites data or undoes external transactions.
:::
