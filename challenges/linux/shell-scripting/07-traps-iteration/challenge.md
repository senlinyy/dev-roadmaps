---
title: "Traps and Safe File Iteration"
sectionSlug: safe-file-iteration-with-null-delimiters
order: 7
---

Production scripts need cleanup handlers and safe file processing. The `trap` built-in runs code on exit, and null delimiters handle filenames with spaces safely.

You start in `/home/dev`. Your job:

1. **Open vim** with `vim cleanup-demo.sh` and write a script that:
   - Starts with `#!/usr/bin/env bash` and `set -euo pipefail`
   - Defines a `cleanup` function that prints `cleanup done`
   - Registers it with `trap cleanup EXIT`
   - Prints `working...` as the main logic
   - Save with `:wq`
2. **Open vim** with `vim process-logs.sh` and write a script that:
   - Uses the safe file iteration pattern: `while IFS= read -r -d '' file; do ... done < <(find /var/log -name "*.log" -print0)`
   - Inside the loop, prints `Processing: ${file}`
   - Save with `:wq`
3. **Make both executable** with `chmod +x`.

The grader checks that the scripts contain `trap` with `EXIT`, and the safe `read -r -d ''` pattern with `-print0`.
