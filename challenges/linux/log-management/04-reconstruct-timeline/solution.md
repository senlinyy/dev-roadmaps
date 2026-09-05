```bash
journalctl -u app.service -b --since "2026-09-01 10:17:00" --until "2026-09-01 10:19:00"
journalctl -k -b --since "2026-09-01 10:17:00" --until "2026-09-01 10:19:00"
journalctl _COMM=sudo -b --since "2026-09-01 10:17:00" --until "2026-09-01 10:19:00"
journalctl -u app.service -b _PID=2101
```
