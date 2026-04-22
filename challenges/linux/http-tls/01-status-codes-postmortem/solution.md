```bash
$ cat /home/dev/postmortem/checkout-502.txt
$ grep " 502 " /var/log/nginx/access.log
$ grep -c " 502 " /var/log/nginx/access.log
$ grep "/api/checkout" /var/log/nginx/access.log
```

The curl dump confirms the literal `502 Bad Gateway` body nginx served; the access-log greps prove the failure was scoped to `POST /api/checkout` hitting upstream `10.0.2.11:3000`.
