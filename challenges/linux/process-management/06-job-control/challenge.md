---
title: "Job Control and Background Tasks"
sectionSlug: job-control-and-background-tasks
order: 6
---

The shell keeps a job table that tracks processes you have started, stopped, or backgrounded. Understanding the `STAT` column in `/proc` status files tells you whether a process is running (R), sleeping (S), stopped (T), or a zombie (Z).

You start in `/home/dev`. Your job:

1. **Read the job table** by examining `/proc/*/status` to find a stopped process (state `T`).
2. **Identify which process stopped it** by checking the PPid of the stopped process.
3. **Find the environment variable** that records the signal used to stop it by reading `/proc/<pid>/environ`.

The grader requires you to use `cat` and `grep`, and your combined output must contain the stopped process name, its state, and the word "SIGTSTP".
