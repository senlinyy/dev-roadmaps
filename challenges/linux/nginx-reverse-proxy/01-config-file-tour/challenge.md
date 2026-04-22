---
title: "Tour the /etc/nginx Tree"
sectionSlug: nginx-config-file-structure
order: 1
---

You're picking up the on-call rotation and have never looked at this box's nginx layout. Before any incident lands, walk the `/etc/nginx/` tree end-to-end so you know which file owns which behavior. The runtime here has no symlinks, so `sites-enabled/` holds plain copies of the live virtual hosts — treat them as the active set.

You start in `/home/dev`. Your job:

1. **List the full nginx tree** with `ls -la /etc/nginx/` and `ls /etc/nginx/sites-available/ /etc/nginx/sites-enabled/` so you can see every config file at a glance.
2. **Read the top-level config** at `/etc/nginx/nginx.conf` to confirm which `include` line pulls in the per-site configs.
3. **Confirm which sites are actually live** by running `ls /etc/nginx/sites-enabled/` — only files in `sites-enabled/` get loaded.
4. **Check the worker tuning** by running `grep "worker_" /etc/nginx/nginx.conf` to record the `worker_processes` and `worker_connections` values.

The grader requires you to use `ls`, `cat`, and `grep`, and your combined output must contain `sites-enabled`, `worker_processes`, `worker_connections`, `www.conf`, and `api.conf`.
