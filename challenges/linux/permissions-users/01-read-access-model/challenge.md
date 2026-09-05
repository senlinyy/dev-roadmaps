---
title: "Read the Access Model"
sectionSlug: how-does-linux-decide-which-process-may-access-an-object
order: 1
revision: 1
---

You have joined an incident review for a web application. The configuration file is readable to the service team, but the team wants evidence of exactly which identity and permission class make that possible before anyone changes the server.

You start in `/home/dev`. Your job:

1. **Inspect your effective user and active groups.**
2. **Read the long listing for `/srv/web/config.env`** and identify its owner, group, and mode.
3. **Inspect the file metadata numerically** so the symbolic and octal views agree.

Do not change the file. The grader checks the inspection commands and confirms that the original access model remains intact.
