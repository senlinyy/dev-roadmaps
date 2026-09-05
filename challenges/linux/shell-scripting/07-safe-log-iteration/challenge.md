---
title: "Iterate Safely Over Log Files"
sectionSlug: how-do-you-iterate-over-input-without-turning-data-into-shell-syntax
order: 7
---

`process-logs.sh` breaks a pathname at whitespace because it turns command output into a shell word list. The log tree includes both ordinary and awkward filenames.

You start in `/home/dev`. Your job:

1. **Replace the whitespace-splitting loop** with a null-delimited producer and reader.
2. **Keep each discovered log path quoted** when it is printed.
3. **Run the script** and print both full paths, including `/var/log/orders/night shift.log` as one line.

The grader checks the safe iteration structure, actual execution, and both preserved pathnames.
