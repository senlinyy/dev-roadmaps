```bash
$ grep "myapp" /var/log/journal-export.log
$ grep -i "error" /var/log/journal-export.log
$ grep -c "postgresql" /var/log/journal-export.log
$ grep "502" /var/log/journal-export.log
```

`grep "myapp"` isolates all entries from that service, revealing the crash and recovery sequence. `grep -i "error"` catches both `ERROR` (from myapp) and `error` in other contexts. `grep -c "postgresql"` returns `5` because postgresql appears in five log lines. `grep "502"` pulls out the upstream failure entries.
