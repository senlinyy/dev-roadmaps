---
title: "Tour the /etc/nginx Tree"
sectionSlug: nginx-config-file-structure
order: 1
---

You're picking up the on-call rotation and have never looked at this box's nginx layout. Before any incident lands, walk the `/etc/nginx/` tree end-to-end so you know which file owns which behavior. The runtime here has no symlinks, so `sites-enabled/` holds plain copies of the live virtual hosts, treat them as the active set.

You start in `/home/dev`. Your job:

1. **Inventory the `/etc/nginx/` tree** so you can see the top-level directories and the available vs enabled site files.
2. **Inspect `/etc/nginx/nginx.conf`** and find the include rule that pulls in the live per-site configs.
3. **Identify which virtual hosts are actually active** by checking the files present under `sites-enabled/`.
4. **Surface the worker tuning values** so you can record the current `worker_processes` and `worker_connections` settings.

The grader requires you to use `ls`, `cat`, and `grep`, and your combined output must contain `sites-enabled`, `worker_processes`, `worker_connections`, `www.conf`, and `api.conf`.
