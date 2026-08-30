`df` accounts for allocated filesystem blocks, while `du` walks names that are still reachable in the directory tree.

---

If a process opened a file before its pathname was removed, the process can keep the inode alive.

---

The open-file inspection tool can select entries whose link count is below one with its `+L1` filter.
