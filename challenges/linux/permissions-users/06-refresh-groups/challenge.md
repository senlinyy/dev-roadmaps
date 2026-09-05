---
title: "My New Group Still Doesn't Work"
sectionSlug: how-do-uids-and-gids-represent-users-and-groups
order: 6
revision: 1
---

An administrator added `dev` to the `docker` group, but this shell was opened before the change. The account database contains the new membership while the running session still has its old group list.

You start in `/home/dev`. Your job:

1. **Inspect the current identity** and reproduce the failed read check on `/var/run/docker.sock`.
2. **Refresh this shell's active group context** without changing the socket mode.
3. **Inspect the identity again and prove the socket is now readable.**

The grader checks the original denial, the refreshed session groups, and unchanged socket permissions.
