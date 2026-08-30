---
title: "Find the Missing Configuration"
sectionSlug: how-do-you-find-files-and-commands
order: 4
revision: 2
---

The `orders-api` startup message names `database.conf`, but the runbook does not record its path. The deployment also contains several service-specific configuration fragments that need to be reviewed together.

You start in `/home/dev`. Your job:

1. **Locate `database.conf`** somewhere below `/etc` without guessing every directory.
2. **Inspect the deployment tree** under `/opt/orders-api` to a depth of two levels.
3. **Find every `.conf` file** in that deployment tree.

The grader checks that both search results and the deployment layout were inspected.
