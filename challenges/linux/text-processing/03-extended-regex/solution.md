```bash
grep -Ei "error|warn" /var/log/app.log
grep -Ei "error|warn" /var/log/app.log | wc -l
grep -E "08:1|08:2" /var/log/app.log
```

`-E` enables extended regular expressions so the `|` (pipe/alternation) character works without escaping. `-i` makes it case-insensitive. The pipe to `wc -l` counts the matching lines. The third command uses a simple alternation to match two timestamp prefixes.
