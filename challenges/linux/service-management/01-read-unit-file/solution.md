```bash
$ cat /etc/systemd/system/myapp.service
$ grep ExecStart /etc/systemd/system/myapp.service
$ grep User /etc/systemd/system/myapp.service
$ grep Restart= /etc/systemd/system/myapp.service
$ grep Type /etc/systemd/system/nginx.service
```

`cat` shows the full unit file so you can understand its structure. `grep` pulls out specific directives: `ExecStart` reveals the startup command, `User` shows the runtime identity, `Restart` shows the failure policy, and `Type=forking` in nginx means it daemonizes itself (unlike myapp's `simple` type).
