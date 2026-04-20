```bash
$ ls /var/log/
$ grep -r "sshd" /var/log/
$ tail /var/log/syslog
$ cat /var/log/syslog
```

`ls /var/log/` reveals the directory layout. `grep -r "sshd"` recursively searches every file and shows that `auth.log` and `syslog` both contain SSH entries. Reading syslog with `cat` or `tail` shows the mix of services: cron, sshd, nginx, kernel, and systemd.
