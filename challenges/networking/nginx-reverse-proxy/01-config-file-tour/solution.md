```bash
$ ls -la /etc/nginx/
$ ls /etc/nginx/sites-available/ /etc/nginx/sites-enabled/
$ cat /etc/nginx/nginx.conf
$ ls /etc/nginx/sites-enabled/
$ grep "worker_" /etc/nginx/nginx.conf
```

`sites-enabled/` contains `www.conf` and `api.conf` (the two live virtual hosts); `legacy.conf` exists in `sites-available/` but is intentionally not enabled. `worker_processes auto` and `worker_connections 1024` are the two tuning knobs you'll want to know before any traffic incident.
