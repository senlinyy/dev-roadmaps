```bash
head -n 2 /var/log/orders/status-sample.log
cut -d' ' -f5 /var/log/orders/status-sample.log | sort | uniq -c | sort -nr
```

Sorting before `uniq` groups nonadjacent occurrences. The final sort ranks counts rather than status values.
