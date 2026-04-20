---
title: "Diagnose Swap Usage"
sectionSlug: swap-when-it-helps-and-when-it-kills-you
order: 5
---

Swap is disk-backed virtual memory. A small amount of swap usage is normal, but heavy swap activity (thrashing) means the system is running out of physical memory and constantly shuffling pages between RAM and disk.

You start in `/home/dev`. Your job:

1. **Check total swap usage** by reading `/proc/meminfo` and finding the `SwapTotal` and `SwapFree` lines.
2. **Find which process is using the most swap** by reading the `VmSwap` field from `/proc/*/status` files.
3. **Check the swappiness setting** by reading `/proc/sys/vm/swappiness`.

The grader requires you to use `cat` and `grep`, and your combined output must contain "SwapTotal", "SwapFree", "VmSwap", and the swappiness value "60".
