---
title: "Record the Rollback Target"
sectionSlug: automation-and-stop-rules
order: 3
---

The release record names the new task definition, but it does not name the safe place to return to if the rollout fails. The last known-good release is task definition `orders-api:41`, version `1.8.3`, at digest `sha256:2b91fe0a7a61`. Its compatibility review confirmed that version 1.8.3 can read rows written during the 1.8.4 rollout.

Your task:

1. **Add the known-good task definition** as the rollback target.
2. **Record its version and image digest** so the target is not just a friendly label.
3. **State the confirmed data compatibility** before rollback is considered safe.
4. **Add verification checks** that `/version` reports `orders-api:41` and `/smoke/checkout` passes.

The grader checks the structured release record.
