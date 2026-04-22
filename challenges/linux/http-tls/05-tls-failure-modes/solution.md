```bash
$ cat /var/log/incidents/api-handshake.curl
$ cat /var/log/incidents/legacy-handshake.curl
$ grep "verify|subjectAltName" /var/log/incidents/api-handshake.curl /var/log/incidents/legacy-handshake.curl
$ tail -n 5 /var/log/nginx/error.log
```

api.example.com fails with `certificate verify failed` (missing intermediate / chain-of-trust problem), legacy.example.com fails with `subjectAltName does not match` (the cert is for `www.example.com` not `legacy.example.com`), and nginx's own error log shows matching `upstream prematurely closed connection` lines for both — two separate root causes, two separate tickets.
