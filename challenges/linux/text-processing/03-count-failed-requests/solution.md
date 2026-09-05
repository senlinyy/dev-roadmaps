```bash
head -n 2 /var/log/orders/access.log
grep -E '^([^ ]+ ){4}401 ' /var/log/orders/access.log
grep -E '^([^ ]+ ){4}401 ' /var/log/orders/access.log | wc -l
```

The field-aware match excludes the URL and byte-count distractors. The final count is four.
