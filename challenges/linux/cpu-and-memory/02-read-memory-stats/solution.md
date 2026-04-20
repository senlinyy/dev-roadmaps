```bash
$ cat /proc/meminfo
$ grep MemAvailable /proc/meminfo
$ free
$ grep Cached /proc/meminfo
```

MemAvailable (5242880 kB) accounts for reclaimable cache, so it is always larger than MemFree (524288 kB). Swap in use is 1048576 kB (SwapTotal 2097152 minus SwapFree 1048576). The page cache holds 4096000 kB.
