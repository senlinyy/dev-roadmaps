For counting matches, pipe `grep -i "error" file` into `wc -l`.

---

Use `cut -d' ' -f3` to extract the third space-separated field (the log level), then `sort | uniq`.

---

To get error messages only: `grep -i "error" file | cut -d' ' -f4-` extracts field 4 onward. Then `sort | uniq -c | sort -rn` counts and ranks them.
