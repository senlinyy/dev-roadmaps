```bash
$ cat /home/dev/severity-reference.txt
$ grep "ERROR" /var/log/app/application.log
$ grep -c "WARNING" /var/log/app/application.log
$ grep "CRITICAL" /var/log/app/application.log
```

`grep "ERROR"` matches all three ERROR lines. `grep -c "WARNING"` returns `4` because there are four WARNING entries. `grep "CRITICAL"` catches the two most severe messages about database exhaustion and the watchdog failure.
