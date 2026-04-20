---
title: "Decode Process Signals"
sectionSlug: signals-how-everything-talks-to-a-process
order: 3
---

Signals are how the kernel and other processes communicate with a running program. Some signals can be caught and handled; others cannot. Knowing the difference is critical for writing reliable services.

You start in `/home/dev`. Your job:

1. **Read the signal reference table** in `signal-table.txt` and identify which signals cannot be trapped.
2. **Read `cleanup.sh`** to see which signals the script traps.
3. **Grep the signal table** for the default `kill` signal and find its number.

The grader requires you to use `cat` and `grep`, and your combined output must include SIGKILL, SIGSTOP, SIGTERM, SIGINT, and the number 15.
