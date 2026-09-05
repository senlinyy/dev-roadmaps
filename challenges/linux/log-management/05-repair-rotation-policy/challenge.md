---
title: "Repair the Rotation Policy Safely"
sectionSlug: how-does-rotation-keep-file-and-journal-logs-bounded
order: 5
---

The proposed Nginx rotation policy uses the wrong schedule, retention, and creation permissions. You start in `/home/dev`. Only `/etc/logrotate.d/nginx` may be repaired; do not perform an actual rotation.

1. **Inspect the saved policy** and retain its existing reopen hook and compression behavior.
2. **Set daily rotation with fourteen archived copies** and fresh files owned by `www-data:adm` with mode `0640`.
3. **Preserve missing-file and empty-file handling**, delayed compression, and one shared reopen action.
4. **Validate the saved policy in debug mode**, leaving the current and rotated logs unchanged.

The grader checks the parsed policy and a dry run of its current saved content. The simulator supports this single authored rule, not arbitrary logrotate scripts.
