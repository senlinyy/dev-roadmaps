```bash
journalctl -u app.service -n 2 --no-pager
journalctl -u app.service --since "2026-09-01 10:17:00" --until "2026-09-01 10:23:00" --no-pager
```
