---
title: "Ownership and Groups"
sectionSlug: ownership-with-chown-and-chgrp
order: 5
---

A project directory needs proper ownership for team collaboration. Use the available commands to inspect and fix ownership.

1. Run `id` to see your current user and group information.
2. Run `ls -l /opt/project` to check the current ownership of files.
3. Use `chown dev:devs /opt/project/app.py` to change the owner and group of the application file.
4. Use `chgrp devs /opt/project/README.md` to change just the group.
5. Verify with `ls -l /opt/project`.
