---
title: "Keep a Path as One Argument"
sectionSlug: how-do-expansion-quoting-arguments-and-environment-values-work
order: 4
---

`show-status.sh` receives a report path, but a release directory with spaces makes the script treat one pathname as several arguments.

You start in `/home/dev`. Your job:

1. **Repair `show-status.sh`** so the supplied path remains one argument after expansion.
2. **Run it with `/home/dev/release notes/status.txt` as one positional argument**.
3. **Produce the report content** `approved for production` without renaming the directory or file.

The grader checks the quoted expansion, exact argument boundary, script exit status, and output.
