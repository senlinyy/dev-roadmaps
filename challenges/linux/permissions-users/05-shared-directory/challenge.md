---
title: "Build a Shared Engineering Directory"
sectionSlug: how-should-service-and-deploy-users-share-files
order: 5
revision: 1
---

Engineers can edit `/srv/project`, but new files inherit each creator's private group. That makes collaboration unreliable and forces repeated ownership repairs. The directory needs a durable shared-group policy.

You start in `/home/dev` as a member of `developers`. Your job:

1. **Assign the project directory to the shared engineering group.**
2. **Keep owner and group collaboration access, deny access to others, and enable group inheritance.**
3. **Create a proof file as yourself** and inspect both objects to verify the inherited group.

The grader checks the setgid directory mode and the proof file's owner, group, and creation mode.
