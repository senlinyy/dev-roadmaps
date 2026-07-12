```bash
grep -i "error" /var/log/syslog | wc -l
cut -d' ' -f3 /var/log/syslog | sort | uniq
grep -i "error" /var/log/syslog | cut -d' ' -f4- | sort | uniq -c | sort -rn
```
