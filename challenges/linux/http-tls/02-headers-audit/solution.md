```bash
$ cat /var/log/incidents/api-prod.headers
$ cat /var/log/incidents/api-staging.headers
$ grep -i "Content-Type" /var/log/incidents/api-prod.headers /var/log/incidents/api-staging.headers
$ grep -i "Access-Control-Allow-Origin" /var/log/incidents/api-prod.headers /var/log/incidents/api-staging.headers
```

Both responses are JSON with status 200, but only the staging dump contains `Access-Control-Allow-Origin` — the prod deploy dropped the CORS header block, which is why the browser is rejecting the response.
