```bash
$ cat /etc/systemd/system/webapp.service
$ grep Requires /etc/systemd/system/webapp.service
$ grep Wants /etc/systemd/system/webapp.service
$ grep -r After /etc/systemd/system/
```

`Requires=postgresql.service` is a hard dependency: if postgresql fails, systemd will stop webapp too. `Wants=redis.service` is a soft dependency: webapp starts even if redis is down. `After=` controls boot ordering, ensuring network and postgresql are ready before webapp launches.
