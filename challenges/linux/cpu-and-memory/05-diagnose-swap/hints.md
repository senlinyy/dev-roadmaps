Use `grep Swap /proc/meminfo` to find the system-wide swap lines. Then use `grep VmSwap /proc/*/status` to see per-process swap usage. The swappiness value lives in `/proc/sys/vm/swappiness`.
