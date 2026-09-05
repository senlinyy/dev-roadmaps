```bash
free -h
ps -eo pid,user,rss,vsz,cmd --sort=-rss
systemctl show orders.service -p MainPID --value
cat /proc/2001/status
sudo cat /proc/2001/smaps_rollup
```

Use the PID returned by systemctl; a fresh lab returns 2001. RSS and virtual size in ps are KiB. PSS apportions shared pages across processes.
