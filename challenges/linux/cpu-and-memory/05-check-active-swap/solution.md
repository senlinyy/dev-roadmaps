```bash
free -h
vmstat 5 3
cat /proc/pressure/memory
ps -eo pid,user,rss,cmd --sort=-rss
cat /proc/920/status
```

The authored samples show activity over time; they do not emulate Linux page reclaim.
