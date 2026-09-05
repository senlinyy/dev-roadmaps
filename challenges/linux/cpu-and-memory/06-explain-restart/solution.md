```bash
journalctl -k --since '1 hour ago' --no-pager
journalctl -u orders.service --since '1 hour ago' --no-pager
systemctl show orders.service -p MainPID --value
cat /proc/2001/status
```

Use the current PID returned by systemctl; a fresh lab returns 2001. The earlier OOM is an authored historical event, not a live memory-allocation simulation.
