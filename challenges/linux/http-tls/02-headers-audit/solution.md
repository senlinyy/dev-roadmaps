```bash
$ cat /home/dev/postmortem/api-prod-headers.txt
$ cat /home/dev/postmortem/api-staging-headers.txt
$ grep -i "Content-Type" /home/dev/postmortem/api-prod-headers.txt /home/dev/postmortem/api-staging-headers.txt
$ grep -i "Access-Control-Allow-Origin" /home/dev/postmortem/api-prod-headers.txt /home/dev/postmortem/api-staging-headers.txt
```

Both responses are JSON with status 200, but only the staging dump contains `Access-Control-Allow-Origin` — the prod deploy dropped the CORS header block, which is why the browser is rejecting the response.
