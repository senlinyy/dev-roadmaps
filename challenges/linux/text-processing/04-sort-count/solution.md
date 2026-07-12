```bash
cut -d' ' -f1 /var/log/access.log | sort | uniq -c | sort -rn | head -n 3
```
