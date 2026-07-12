---
title: "Separate Severity From Noise"
sectionSlug: severity-and-signal
order: 2
---

A deploy produced a noisy mix of info, warning, error, and critical lines. You start in `/home/dev`, and the relevant exports are `/var/log/syslog` and `/var/log/app/orders-api.log`.

Your job:

1. **Inspect both files** to understand their formats.
2. **Surface the warning** that happened before the failure.
3. **Surface the error and critical lines** that should drive the incident response.
4. **Keep routine info lines out of your final evidence** unless you need them for context.

The grader checks that you found high-signal severity evidence across both files.
