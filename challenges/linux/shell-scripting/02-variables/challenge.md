---
title: "Variables in Action"
sectionSlug: variables-assigning-reading-and-quoting
order: 2
---

Variables in Bash are untyped strings. You assign them without spaces around `=`, reference them with `$`, and use `${var}` when you need to disambiguate where the name ends.

You start in `/home/dev`. Your job:

1. **Set a variable** called `APP` to `devpolaris` (directly at the prompt, e.g. `APP=devpolaris`).
2. **Create a script** called `deploy.sh` that uses variables with curly-brace expansion. Use `vim deploy.sh` to write the script, or `echo` with redirection if you prefer. The script should print:
   - `Deploying devpolaris...` (using `$APP`)
   - `Log: /var/log/devpolaris_deploy.log` (using `${APP}_deploy`)
3. **Run the script** with `bash deploy.sh` (not `./`, so the current env is passed).

The grader checks that your output contains both the deploy line and the log path with the correct variable expansion.
