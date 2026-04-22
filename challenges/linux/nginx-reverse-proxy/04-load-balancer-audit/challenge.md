---
title: "Audit a Lopsided Load Balancer"
sectionSlug: basic-load-balancing
order: 4
---

The dashboard shows backend `10.0.0.10` running hot while `10.0.0.12` is barely used. You suspect the upstream pool was edited recently and a backend got marked `down`. Read the upstream block, count requests per backend in the log, and confirm the disabled host received zero traffic.

You start in `/home/dev`. Your job:

1. **Inspect the upstream pool config** at `/etc/nginx/conf.d/upstream.conf` so every backend and weight is visible.
2. **Find the backend that is explicitly disabled or otherwise removed from rotation**.
3. **Measure how much traffic the hot and cold backends actually received** using `/var/log/nginx/upstream-access.log`.
4. **Confirm whether `10.0.0.11` received any traffic at all** so you can prove whether it was skipped entirely.

The grader requires you to use `cat` and `grep`, and your combined output must contain `upstream backend`, `10.0.0.10`, `10.0.0.11`, `10.0.0.12`, and `down`.
