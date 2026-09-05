---
title: "Repair Command Lookup"
sectionSlug: how-do-the-shebang-execute-bit-and-path-select-execution
order: 3
---

The executable `/home/dev/tools/release-status` is installed correctly, but the shell cannot resolve the command name from the current environment.

You start in `/home/dev`. Your job:

1. **Add `/home/dev/tools` to the current shell's command search path** while retaining the standard directories.
2. **Show the resolved executable path** for `release-status`.
3. **Run the command by name** and produce `release ready`.

The grader checks the lookup evidence and that the resolved virtual script actually ran through PATH.
