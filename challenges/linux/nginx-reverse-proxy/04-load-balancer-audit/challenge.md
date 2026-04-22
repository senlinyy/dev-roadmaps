---
title: "Audit a Lopsided Load Balancer"
sectionSlug: basic-load-balancing
order: 4
---

The dashboard shows backend `10.0.0.10` running hot while `10.0.0.12` is barely used. You suspect the upstream pool was edited recently and a backend got marked `down`. Read the upstream block, count requests per backend in the log, and confirm the disabled host received zero traffic.

You start in `/home/dev`. Your job:

1. **Read the upstream config** at `/etc/nginx/conf.d/upstream.conf` to list every backend in the pool.
2. **Find any backend marked down** by running `grep "down" /etc/nginx/conf.d/upstream.conf`.
3. **Count requests served by 10.0.0.10** with `grep -c "upstream=10.0.0.10" /var/log/nginx/upstream-access.log`, and the same for `10.0.0.12`.
4. **Confirm `10.0.0.11` got zero traffic** by running `grep "upstream=10.0.0.11" /var/log/nginx/upstream-access.log` (no output proves it was skipped).

The grader requires you to use `cat` and `grep`, and your combined output must contain `upstream backend`, `10.0.0.10`, `10.0.0.11`, `10.0.0.12`, and `down`.
