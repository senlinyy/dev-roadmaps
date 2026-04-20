```bash
$ cat /var/log/broken-journal.log
$ grep status /var/log/broken-journal.log
$ cat /etc/systemd/system/broken.service
$ grep After /etc/systemd/system/broken.service
```

The journal log reveals status 203/EXEC, meaning the binary at `/usr/bin/myapp` does not exist. The unit file compounds the problem: it declares `After=postgresql.service` for ordering but omits `Requires=postgresql.service`, so there is no guarantee postgresql is running when broken.service starts.
