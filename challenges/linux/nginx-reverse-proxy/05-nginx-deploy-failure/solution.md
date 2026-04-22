```bash
$ cat /home/dev/postmortem/nginx-t.txt
$ cat /etc/nginx/sites-available/api.conf
$ grep -n "proxy_passs" /etc/nginx/sites-available/api.conf
$ tail -n 3 /var/log/nginx/access.log
```

`nginx -t` reported `[emerg] unknown directive "proxy_passs" in /etc/nginx/sites-available/api.conf:14` — a typo (three s's instead of two). The access log shows the user-facing fallout: repeated `502` responses on `/api/v2/users` while the bad config blocked the deploy.
