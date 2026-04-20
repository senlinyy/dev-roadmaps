---
title: "Hunt Down Files"
sectionSlug: finding-files-find-locate-and-tree
order: 4
---

Linux gives you several tools to search for files: `find` walks the directory tree in real time, `locate` queries a pre-built index for speed, and `tree` gives you a visual overview of directory structure.

You start in `/home/dev`. Your job:

1. **Find all `.conf` files under `/etc`** using `find`.
2. **Find all `.log` files under `/var/log`** using `find`.
3. **Use `tree`** to get a visual overview of `/etc` limited to **2 levels deep**.
4. As your final command, **find files larger than 1M under `/var`** using `find` with the `-size` flag.

The grader checks that you used `find` and `tree`, and that your last output contains the large file path.
