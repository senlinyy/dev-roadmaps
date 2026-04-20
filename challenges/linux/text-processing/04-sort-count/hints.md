Use `cut -d' ' -f1` to extract just the first field (the IP address) from each line.

---

Remember: `uniq` only removes adjacent duplicates, so you must `sort` before piping into `uniq -c`.

---

The full pipeline shape is: `cut ... | sort | uniq -c | sort -rn | head -n 3`.
