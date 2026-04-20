---
title: "Exit Codes and Chaining"
sectionSlug: exit-codes-traps-and-cleanup
order: 3
---

Every command returns an exit code: `0` for success, non-zero for failure. You can check the last exit code with `$?` and chain commands with `&&` (run next only if previous succeeded) and `||` (run next only if previous failed).

You start in `/home/dev`. Your job:

1. **Run a command that succeeds** (e.g. `echo "ok"`) and then **print its exit code** with `echo $?`. You should see `0`.
2. **Run a command that fails** (e.g. `cat /no/such/file`) and then **print its exit code**. You should see a non-zero value.
3. **Use `&&`** to create a directory AND write a file into it in a single line:
   `mkdir -p /home/dev/logs && echo "started" > /home/dev/logs/app.log`
4. **Use `||`** to try reading a file that does not exist and print a fallback message:
   `cat /home/dev/missing.txt || echo "File not found, using defaults"`

The grader checks that `$?` was used, the `logs/app.log` file was created, and the fallback message appeared.
