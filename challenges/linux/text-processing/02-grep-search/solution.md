```bash
grep -in "error" /var/log/app.log
grep -c "WARN" /var/log/app.log
grep -v "INFO" /var/log/app.log
```

`-in` combines case-insensitive and line-number output. `-c` prints the count of matching lines (3 WARN lines). `-v` inverts the match to show everything except INFO lines.
