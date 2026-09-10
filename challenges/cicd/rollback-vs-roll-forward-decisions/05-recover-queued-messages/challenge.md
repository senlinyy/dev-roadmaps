---
retired: true
title: "Contain Consumers Without Erasing the Queue"
sectionSlug: why-do-data-apis-messages-side-effects-and-migrations-complicate-recovery
order: 4
revision: 1
---

## Current situation

Green has emitted v2 order messages and then failed. Blue understands only v1; the supplied hotfix understands both message versions. Producers have already committed messages that must not be deleted. Inspect `scenario.json` for the retained release contracts and case evidence.

## The issue

The starter immediately restores blue with consumers running. Reverting the binary leaves v2 messages in the queue and causes repeated processing failures.

## Your task

Contain message processing before recovery, deploy the compatible hotfix with a sufficient readiness deadline, and verify the recovered API while consumers remain paused for an operator-controlled restart. Handle both v1 backlog and v2 backlog without deleting or rewriting either.

Edit `deployment.yaml` only. Keep `scenario.json` unchanged. Run all cases, inspect the state timeline and logs, then use **Check Run** on a fresh run.

## Success criteria

- **v2 backlog:** Queued v2 messages survive binary replacement. Required result: **recovered** on **hotfix**.
- **v1 backlog:** The same hotfix must also handle older messages. Required result: **recovered** on **hotfix**.

Every case must preserve the disclosed safety boundaries throughout execution, not just finish at the right release. Setup errors, skipped work and stale run results do not prove a safe stop.

:::expand[Simulation format]{kind="note"}
This is bounded deployment teaching YAML, not Kubernetes, GitHub Actions or an executable shell script. Use `version: 1` with an ordered `steps` list; each step has one operation and its option mapping. recover selects a retained release, inspectCompatibility (boolean), and timeout seconds. mitigate supports disable-flag, pause-consumers or zero-traffic. inspect and verify have empty mappings. Compatibility uses the current schema, queued-message and session contracts; no action rewrites data or undoes external transactions.
:::
