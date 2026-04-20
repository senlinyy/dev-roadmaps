---
title: "Use vmstat for Triage"
sectionSlug: vmstat-the-five-second-triage-tool
order: 3
---

`vmstat` gives you a single-line snapshot of CPU, memory, swap, and I/O activity. Each column tells a story: `r` is the run queue (processes waiting for CPU), `wa` is I/O wait, and `si`/`so` reveal swap activity.

You start in `/home/dev`. Your job:

1. **Run `vmstat`** and read the output row.
2. **Find how many processes are waiting for CPU** (the `r` column).
3. **Identify the I/O wait percentage** (the `wa` column under cpu).
4. **Check for swap activity** by looking at `si` and `so` (swap in and swap out per second).
5. **Read the reference file** at `/home/dev/vmstat-reference.txt` to confirm which column is which.

The grader requires you to use `vmstat` and `cat`, and your combined output must contain the key values from the vmstat data row and the reference file content.
