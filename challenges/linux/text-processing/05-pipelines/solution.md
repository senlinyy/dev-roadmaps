```bash
grep -i "error" /var/log/syslog | wc -l
cut -d' ' -f3 /var/log/syslog | sort | uniq
grep -i "error" /var/log/syslog | cut -d' ' -f4- | sort | uniq -c | sort -rn
```

Pipeline 1 counts error lines (4). Pipeline 2 extracts log levels and shows sorted unique values (ERROR, INFO, WARN). Pipeline 3 extracts just the error message text, counts occurrences, and ranks them by frequency.
