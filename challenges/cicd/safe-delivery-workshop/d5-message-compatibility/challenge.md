---
title: "Process old and new queue messages without duplicate effects"
sectionSlug: process-old-and-new-queue-messages-without-duplicate-effects
order: 5
revision: 1
---

## Description

The Orders queue contains legacy messages with `total_cents` and version-2 messages with `amount_cents`. Redelivery is expected, but the new worker rejects the backlog and can insert a second business effect when the same event arrives again.

As the application engineer, make the PostgreSQL-backed worker compatible with both message versions and safe to retry.

## Requirements

1. **Payload Compatibility**. Parse legacy and version-2 payloads into the same order representation while rejecting unsupported or malformed messages.
2. **Transactional Deduplication**. Record the event identity and insert the order in one transaction so duplicate event IDs cannot repeat the database effect.
3. **Acknowledgment Timing**. Acknowledge a message only after the transaction commits successfully.
4. **Failure Handling**. Leave parsing and database failures unacknowledged for the existing retry/dead-letter handling rather than silently discarding them.

:::expand[Workspace and verification]{kind="note"}

Editable files: `db/worker.sql`, `worker/consume.py`. Other tabs are supplied fixtures or incident evidence; preserve them. Each challenge is an independent snapshot.

No CI runner or cloud account executes in this editor. Compare your work with the reference solution and checklist. Optional local or live verification requires the tools and isolated resources described in the solution; the supplied evidence is not output from your edits.

:::
