```bash
$ cat /var/log/incidents/api-prod.headers
$ cat /var/log/incidents/api-staging.headers
$ grep -i "cache-control" /var/log/incidents/api-prod.headers /var/log/incidents/api-staging.headers
$ grep -i "x-request-id" /var/log/incidents/api-prod.headers /var/log/incidents/api-staging.headers
$ grep -i "access-control" /var/log/incidents/api-prod.headers /var/log/incidents/api-staging.headers
$ echo "prod missing access-control-allow-origin" > /home/dev/reports/api-header-diff.note
$ echo "prod x-request-id 7f2c-prod-9911" >> /home/dev/reports/api-header-diff.note
$ echo "staging x-request-id 7f2c-staging-4471" >> /home/dev/reports/api-header-diff.note
$ cat /home/dev/reports/api-header-diff.note
```

Both environments still return the same cache policy and normal request IDs, which proves you are comparing the same endpoint family. Only staging still emits the `Access-Control-*` block, so prod dropped the CORS headers during deploy.
