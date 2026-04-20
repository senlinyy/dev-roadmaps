---
title: "Hunt the OOM Killer"
sectionSlug: per-process-memory-and-the-oom-killer
order: 4
---

When the kernel runs out of memory, the OOM killer picks a process and terminates it. The evidence lives in the kernel log. By reading `/var/log/kern.log` you can find which process was killed, its PID, and how much memory it was consuming.

You start in `/home/dev`. Your job:

1. **Search `/var/log/kern.log` for OOM messages** using `grep`.
2. **Find which process was killed** and its PID from the log entries.
3. **Find how much memory (anon-rss) the killed process was using** from the "Killed process" line.
4. **Check the OOM score adjustment** by reading `/proc/4521/oom_score_adj`.

The grader requires you to use `grep` and `cat`, and your combined output must contain the OOM marker, the killed PID, process name, RSS value, and the OOM score.
