After running any command, type `echo $?` to see its exit code. Success is `0`, failure is non-zero.

---

Use `&&` to chain two commands so the second only runs if the first succeeds: `mkdir -p /home/dev/logs && echo "started" > /home/dev/logs/app.log`

---

Use `||` to provide a fallback when a command fails: `cat /home/dev/missing.txt || echo "File not found, using defaults"`. The `||` operator runs the right side only when the left side fails.
