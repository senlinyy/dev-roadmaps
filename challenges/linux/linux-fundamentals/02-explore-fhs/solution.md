```bash
cat /etc/orders-api/app.conf
tail -n 2 /var/log/orders-api/error.log
ls /srv/orders-api
cat /run/orders-api.pid
```

- `/etc`, `/var/log`, `/srv`, and `/run` answer different operational questions.
- The PID file is runtime state, so it does not belong with persistent configuration.
