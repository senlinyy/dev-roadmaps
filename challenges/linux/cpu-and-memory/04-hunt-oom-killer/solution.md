```bash
$ grep oom /var/log/kern.log
$ cat /proc/4521/oom_score_adj
$ cat /proc/4521/status
```

The kernel killed PID 4521 (node) with an OOM score of 892 and an anon-rss of 7845123 kB. The `oom_score_adj` of 0 means no manual priority adjustment was in place; the process was selected purely by memory size.
