---
retired: true
title: "Roll Forward After a Schema Contract"
sectionSlug: when-is-roll-forward-the-safer-path
order: 3
revision: 2
---

## Current situation

The release removed an old database representation. Blue cannot read the contracted schema; green can but has an application defect. The retained hotfix preserves the current schema and corrects that defect. One case makes the hotfix unhealthy. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter rolls traffic back to blue even though the schema change remains. A binary rollback cannot recreate the removed representation.

## Your task

Replace the unsafe binary rollback with a compatibility-aware roll-forward to the supplied hotfix. Verify healthy recovery; hold when the hotfix cannot reach application health. Do not alter schema fixtures or treat the original green as healthy.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **Compatible hotfix:** Hotfix understands contracted state and passes health. Required result: **recovered** on **hotfix**.
- **Hotfix health failure:** The compatible hotfix fails its application check. Required result: **held** on **green**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. recover selects a retained release, inspectCompatibility (boolean), and timeout seconds. mitigate supports disable-flag, pause-consumers or zero-traffic. inspect and verify have empty mappings. Compatibility uses the current schema, queued-message and session contracts; no action rewrites data or undoes external transactions.
:::
