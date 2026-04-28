```bash
$ ls /etc/systemd/system/
$ cat /etc/systemd/system/backup.timer
$ cat /etc/systemd/system/backup.service
$ cat /etc/systemd/system/cleanup.timer
```

The backup timer uses `OnCalendar=daily` for a calendar-based schedule. The cleanup timer uses `OnBootSec=5min` to run 5 minutes after boot, then `OnUnitActiveSec=6h` to repeat every 6 hours.
