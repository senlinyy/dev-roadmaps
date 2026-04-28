```bash
$ grep Swap /proc/meminfo
$ grep VmSwap /proc/*/status
$ cat /proc/sys/vm/swappiness
```

The system has 4 GB of swap, with 2 GB in use. The java process (PID 500) accounts for 1.5 GB of swap, making it the biggest consumer. Swappiness of 60 is the default, meaning the kernel will start swapping moderately early.
