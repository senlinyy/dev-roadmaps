The `-E` flag enables extended regular expressions. Use `|` between patterns to match either one.

---

Combine `-E` with `-i` for case-insensitive matching of multiple patterns: `grep -Ei "pattern1|pattern2" file`.

---

Pipe the output of `grep` into `wc -l` to count the number of matching lines.
