```bash
cut -d' ' -f1 /var/log/access.log | sort | uniq -c | sort -rn | head -n 3
```

This pipeline: (1) extracts the IP address from each line, (2) sorts them alphabetically so duplicates are adjacent, (3) counts consecutive duplicates, (4) sorts numerically in reverse so the highest count comes first, (5) takes the top 3.
