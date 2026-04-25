```bash
$ cat /var/log/nginx/nginx-t.err
$ cat /etc/nginx/sites-available/api.conf
$ grep -n "proxy_passs" /etc/nginx/sites-available/api.conf
$ echo "api.conf:14 proxy_passs -> proxy_pass http://127.0.0.1:3001;" > /home/dev/reports/nginx-deploy-fix.note
$ cat /home/dev/reports/nginx-deploy-fix.note
```

`nginx -t` reported `[emerg] unknown directive "proxy_passs" in /etc/nginx/sites-available/api.conf:14` — a typo (three s's instead of two). Because validation failed, the correct remediation is to hand back the fixed directive so the deploy can be retried cleanly.
