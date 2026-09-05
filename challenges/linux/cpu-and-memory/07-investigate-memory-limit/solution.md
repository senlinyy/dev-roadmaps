```bash
free -h
systemctl show orders.service -p MemoryMax,Result
journalctl -k --since '1 hour ago' --no-pager
journalctl -u orders.service --since '1 hour ago' --no-pager
```

MemoryMax is inspected as configuration; this lab does not enforce arbitrary allocations or choose OOM victims.
