```bash
$ cat /etc/nginx/sites-available/api.conf
$ cat /srv/app/routes.manifest
$ cat /var/log/incidents/api-prefix-404.curl
$ grep "proxy_pass" /etc/nginx/sites-available/api.conf
$ echo "Use proxy_pass http://127.0.0.1:3000/ so /api/users becomes /users upstream" > /home/dev/reports/proxy-pass-fix.note
$ cat /home/dev/reports/proxy-pass-fix.note
```

Without the trailing slash, Nginx forwards `/api/users` to the backend unchanged. The app only serves `/users`, so the reverse-proxy fix is to use `proxy_pass http://127.0.0.1:3000/;` and strip the `/api/` prefix during forwarding.
