---
title: "Explore the Process Tree"
sectionSlug: pids-ppids-and-the-process-tree
order: 1
---

Every process on Linux has a numeric PID and a parent (PPid). By reading `/proc/<pid>/status`, you can trace any process back to PID 1, the first process started by the kernel.

You start in `/home/dev`. Your job:

1. **Read `/proc/1/status`** to find the name of PID 1.
2. **Trace the parent chain of PID 215** by reading the `status` file for PID 215, then its parent, and so on until you reach PID 1.
3. **Use `grep`** on one of the status files to find which process has a `PPid` of 1.

The grader requires you to use `cat` and `grep`, and your combined output must contain the names of all four processes in the chain: init, sshd, bash, and node.
