```bash
$ cd /etc
$ ls
$ cat hostname
$ cat resolv.conf
$ cd /var/log
$ tail -n 5 syslog
$ cat /etc/os-release
```

`/etc` holds all system-wide configuration. `hostname` is the machine name, `resolv.conf` configures DNS. `/var/log` stores runtime logs. `tail -n 5` grabs the latest entries. `os-release` identifies the distribution and version.
