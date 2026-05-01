---
title: "Record the Rollback Target"
sectionSlug: rolling-back-to-the-previous-task-definition
order: 3
---

The release record names the new task definition, but it does not name the safe place to return to if the rollout fails. A rolling rollback should point back to a known previous task definition and verify it after the service update.

Your task:

1. **Add the previous task definition** as the rollback target.
2. **Record the previous version and image digest** so the target is not just a friendly label.
3. **State the data compatibility assumption** before rollback is considered safe.
4. **Add verification checks** for version and smoke checkout after rollback.

The grader checks the structured release record.

