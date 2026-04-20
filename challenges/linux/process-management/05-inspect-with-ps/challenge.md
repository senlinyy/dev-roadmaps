---
title: "Inspect Processes with ps"
sectionSlug: inspecting-processes-with-ps-top-and-htop
order: 5
---

The `ps` command gives you a snapshot of every running process. The columns you care about most are PID, the process state (STAT), resident memory (RSS), and the command that launched it.

You start in `/home/dev`. Your job:

1. **List all processes** by reading `/proc/*/status` files to find every running process on the system.
2. **Identify the zombie process** by grepping for state `Z` across the status files.
3. **Find the process using the most memory** by comparing the VmRSS values across the status files.

The grader requires you to use `cat` and `grep`, and your combined output must contain the zombie process name and the word "VmRSS".
