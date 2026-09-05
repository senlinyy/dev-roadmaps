```bash
free -h
grep -E 'MemAvailable|Cached|SReclaimable|SUnreclaim' /proc/meminfo
vmstat 5 3
```

The memory summary uses current procps semantics: used is total minus available.
