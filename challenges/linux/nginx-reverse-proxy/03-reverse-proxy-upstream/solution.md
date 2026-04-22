```bash
$ cat /etc/nginx/sites-available/api.conf
$ grep "proxy_pass" /etc/nginx/sites-available/api.conf
$ cat /home/dev/postmortem/v1-200.txt
$ cat /home/dev/postmortem/v2-502.txt
$ cat /home/dev/postmortem/port-check.txt
```

Both upstreams (`3000` and `3001`) are declared in `api.conf`, but only `127.0.0.1:3000` shows up in the `ss -tlnp` capture. The v2 service never started — nginx is fine, the app process is the bug.
