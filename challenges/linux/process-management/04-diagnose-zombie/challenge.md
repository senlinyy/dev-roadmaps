---
title: "Diagnose a Zombie Process"
sectionSlug: failure-modes-zombies-orphans-runaways-and-the-oom-killer
order: 4
---

A zombie process has finished executing but still occupies a slot in the process table because its parent never collected its exit status. Finding and understanding zombies is a core debugging skill.

You start in `/home/dev`. Your job:

1. **Find the zombie process** by searching the `/proc/` status files for the word "zombie".
2. **Identify the zombie's parent PID** from its `PPid` field.
3. **Determine the parent's name** by reading the parent's status file.
4. **Run `ps`** to confirm the zombie appears in the process listing.

The grader requires you to use `grep`, `cat`, and `ps`, and your combined output must include "zombie", "defunct-worker", "500", and "app-server".
