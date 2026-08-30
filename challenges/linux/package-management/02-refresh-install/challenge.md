---
title: "Refresh Before You Install"
sectionSlug: how-does-apt-manage-debian-and-ubuntu-systems
order: 2
revision: 1
---

The health-check script on a new Ubuntu host cannot run because `curl` is missing. The local package index has not been refreshed since the image was built.

You start in `/home/dev`. Your job:

1. **Refresh repository metadata** without upgrading the host.
2. **Install the missing health-check tool** from the configured Ubuntu repository.
3. **Verify the installed inventory** records the expected version.

The grader checks index freshness, installed package state, and the refresh-before-install workflow.
