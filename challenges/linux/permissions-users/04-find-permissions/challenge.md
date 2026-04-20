---
title: "Finding Files by Permission"
sectionSlug: special-permission-bits
order: 4
---

A security audit requires you to find files with specific permissions across the system.

1. Find all files under `/opt` that are world-writable (permissions include write for others). Use `find /opt -perm -002 -type f`.
2. Find all executable files under `/usr/local/bin`. Use `find` with `-perm -001 -type f`.
3. After finding the world-writable files, fix them by setting the insecure file `/opt/data/public.txt` to `644`.
4. Verify with `ls -l /opt/data/public.txt`.
