```bash
journalctl -u app.service -p warning --since "2026-09-01 10:19:00" --until "2026-09-01 10:19:30"
journalctl -u app.service -p info --since "2026-09-01 10:19:00" --until "2026-09-01 10:19:30"
```
