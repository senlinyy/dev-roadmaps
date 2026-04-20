```bash
$ systemctl status nginx
$ grep failed /var/log/systemd-status.txt
$ grep inactive /var/log/systemd-status.txt
```

`systemctl status` shows detailed runtime info for a single service. The status dump file simulates a system-wide overview. `grep failed` isolates myapp (the only service in a failed state), and `grep inactive` finds redis (stopped but not broken).
