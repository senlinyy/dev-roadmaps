```bash
awk '$1 >= "14:00:00" && $1 < "14:15:00" && $5 ~ /^5[0-9][0-9]$/ { print }' /var/log/orders/incident.log > incident-errors.log
wc -l < incident-errors.log
awk '{ print $4 }' incident-errors.log | sort | uniq -c | sort -nr | head -n 1
awk '{ print $2 }' incident-errors.log | sort | uniq -c | sort -nr | head -n 1
head -n 1 incident-errors.log
tail -n 1 incident-errors.log
```

The preserved extract contains six failures. Both rankings and both boundary checks use the same raw evidence.
