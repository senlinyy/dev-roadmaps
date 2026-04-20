```bash
$ vmstat
$ cat /home/dev/vmstat-reference.txt
```

The `r` column shows 3 processes waiting for CPU. I/O wait (`wa`) is 5%, and swap activity is happening: `si` is 120 kB/s in, `so` is 80 kB/s out. Idle CPU (`id`) is only 18%, so this system is under pressure.
