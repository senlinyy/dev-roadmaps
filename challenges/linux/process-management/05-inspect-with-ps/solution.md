$ grep State /proc/*/status
$ grep VmRSS /proc/*/status
$ cat /proc/155/status

The `grep State` scan reveals PID 155 (worker) is in state `Z (zombie)`. The VmRSS comparison shows PID 120 (node) uses the most memory at 98304 kB.
