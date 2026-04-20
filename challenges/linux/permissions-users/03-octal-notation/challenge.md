---
title: "Octal Notation Practice"
sectionSlug: numeric-octal-notation
order: 3
---

A web application has been deployed with default permissions. You need to lock things down properly using octal chmod.

1. Set `/var/www/index.html` to `644` (owner reads/writes, everyone else reads only).
2. Set `/var/www/uploads` to `755` (owner full, others read/traverse).
3. Set `/var/www/config/db.conf` to `640` (owner reads/writes, group reads, others nothing).
4. Set `/var/www/scripts/backup.sh` to `750` (owner full, group reads/executes, others nothing).
5. Verify by running `ls -l /var/www` and `ls -l /var/www/config` and `ls -l /var/www/scripts`.
