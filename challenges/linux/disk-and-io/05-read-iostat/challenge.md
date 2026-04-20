---
title: "Read iostat Output"
sectionSlug: reading-iostat-and-the-io-stack
order: 5
---

The `iostat` command shows per-device I/O statistics. The columns that matter most are `r/s` (reads per second), `w/s` (writes per second), `await` (average latency in milliseconds), and `%util` (how busy the device is).

You start in `/home/dev`. Your job:

1. **Read the iostat snapshot** at `/var/log/iostat-snapshot.txt` to see per-device I/O stats.
2. **Identify the saturated device** by finding which device has `%util` above 90%.
3. **Check the latency** by finding which device has an `await` value above 50ms.

The grader requires you to use `cat` and `grep`, and your combined output must contain "sda", "%util", "await", and "95.20".
