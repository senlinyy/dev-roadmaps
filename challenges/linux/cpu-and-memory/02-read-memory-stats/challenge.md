---
title: "Read Memory Stats"
sectionSlug: why-free-lies-and-available-tells-the-truth
order: 2
---

The kernel exposes every memory counter in `/proc/meminfo`. The `free` command reads from the same source, but knowing how to parse the raw data matters when `free` is unavailable or when you need a field it does not display.

You start in `/home/dev`. Your job:

1. **Read `/proc/meminfo`** and **grep for MemAvailable** to find the available memory in kB.
2. **Run `free`** to see the human-readable summary and confirm the numbers align.
3. **Calculate swap usage**: find SwapTotal and SwapFree in meminfo, then subtract to get swap in use.
4. **Find the page cache size** by grepping for "Cached" in `/proc/meminfo`.

The grader requires you to use `cat`, `grep`, and `free`, and your combined output must contain the MemAvailable value, MemFree, the cache size, and the swap-in-use amount.
