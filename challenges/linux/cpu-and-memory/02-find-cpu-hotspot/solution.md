```bash
top -b -n 1
mpstat -P ALL 5 1
ps -eo pid,user,%cpu,cmd --sort=-%cpu
```

Only batch top is supported here; there is no full-screen monitor.
