---
title: "Broken Deployment Script"
order: 6
---

A wrapper sometimes reports success after a failed build, mishandles paths containing spaces, and removes another job's directory. You start in `/home/dev`. Inspect `deploy.sh` before executing it.

Your job:

1. **Repair the wrapper in Vim** so one input path stays one argument and every run gets a unique temporary directory under `/tmp/deploy.`.
2. **Stop on copy failures and unsuccessful build filtering**, including failures before the last pipeline command. Successful input prints its last `SUCCESS` line and then `deployed`.
3. **Clean up temporary work on shell exit**, whether the run succeeds or fails. Preserve `/tmp/deploy/keep.txt` and both input files.
4. **Run the repaired script with `release build.log`, `failed.log`, and `missing.log`.** Only the first may succeed; the other two must exit with status 1 and must not print `deployed`.

The grader checks saved script structure, actual executions, preserved files, and no leftover temporary directories. The shell models EXIT cleanup, not asynchronous signals or power loss.
