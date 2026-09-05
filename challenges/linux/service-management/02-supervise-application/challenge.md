---
title: "Put an Application Under Supervision"
sectionSlug: how-does-a-unit-file-define-the-service-process
order: 2
---

The release has its executable and environment file, but the service definition is incomplete. Replace the manual launch convention with explicit systemd process instructions. You start in `/home/dev`.

Your job:

1. Complete `/etc/systemd/system/orders.service` for a foreground Node application using the `simple` service type.
2. Run `/usr/bin/node /srv/orders/server.js` as user and group `app`, from `/srv/orders`, with settings from `/etc/orders/app.env`. Preserve the existing description and installation target.
3. Load the completed definition, start `orders.service`, and inspect its state, main PID, user, and working directory.

The grader checks the parsed unit and actual simulated process context. Edit with Vim or another supported file-writing workflow; no particular editing command is required.
