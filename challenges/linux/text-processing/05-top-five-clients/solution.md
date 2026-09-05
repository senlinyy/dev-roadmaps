```bash
head -n 2 /var/log/orders/clients.log
cut -d' ' -f1 /var/log/orders/clients.log | sort | uniq -c | sort -k1,1nr -k2,2 | head -n 5
```

The second sort key makes the tied clients reproducible. Limiting happens only after the full ranking.
