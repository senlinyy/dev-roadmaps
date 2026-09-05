---
title: "Make This Script Run"
sectionSlug: how-do-the-shebang-execute-bit-and-path-select-execution
order: 1
---

A release check was copied into `/home/dev/release`, but direct execution fails before the check can run.

You start in `/home/dev/release`. Your job:

1. **Repair `release-check.sh`** so the operating system can select Bash as its interpreter.
2. **Grant only the missing execution capability** without replacing the script.
3. **Run the script directly** and produce `release check passed`.

The grader checks the script header, executable mode, direct invocation, exit status, and output.
