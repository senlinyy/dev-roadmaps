```bash
$ cat /proc/cpuinfo
$ cat /proc/meminfo
$ cat /proc/version
$ wc -l /proc/cpuinfo
$ cat /proc/loadavg
```

Every file in `/proc` is generated on the fly by the kernel. No data lives on disk. `cpuinfo` describes the CPU, `meminfo` shows RAM stats, `version` gives the kernel build. `loadavg` shows the 1/5/15-minute load averages. Keep it as your final command so the grader sees it.
