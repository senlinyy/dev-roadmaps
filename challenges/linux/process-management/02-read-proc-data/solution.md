```bash
$ grep VmRSS /proc/501/status
$ cat /proc/501/cmdline
$ cat /proc/loadavg
$ grep Threads /proc/501/status
```

`VmRSS` shows the resident set size (physical memory in use). The `cmdline` file reveals this is an nginx worker. `/proc/loadavg` shows the 1, 5, and 15-minute load averages. `Threads` shows the process has 4 threads.
