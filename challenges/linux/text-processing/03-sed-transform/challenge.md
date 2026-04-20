---
title: "Transforming with sed"
sectionSlug: transforming-with-sed
order: 4
---

A configuration file needs updating before deployment. Use `sed` to make the changes.

The config file is at `/home/dev/config.txt`.

1. Use `sed` to replace `localhost` with `0.0.0.0` in the config file and print the result (do not use `-i`).
2. Use `sed` to **delete all comment lines** (lines starting with `#`) from the config and print the result.
3. Now use `sed -i` to actually replace `localhost` with `0.0.0.0` in the file, then verify with `cat`.

The grader checks the final file contents and that your output included the expected transformations.
