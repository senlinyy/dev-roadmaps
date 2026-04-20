```bash
$ df -h
$ du --max-depth=1 -h /
$ find / -type f -size +100M
```

`df -h` confirms the root filesystem is at 92%. `du` reveals `/var` and `/home` as the heaviest directories. `find -size +100M` pinpoints the offenders: `access.log` (2.0G), `core.dump.12345` (1.0G), `cache-main.pack` (512M), `syslog` (500M), and `error.log` (100M).
