```bash
$ ls /var/log/incidents/curl-runs/
$ cat /var/log/incidents/curl-runs/run-2-09-05.curl
$ grep "< HTTP/" /var/log/incidents/curl-runs/run-1-09-01.curl /var/log/incidents/curl-runs/run-2-09-05.curl /var/log/incidents/curl-runs/run-3-09-09.curl
$ grep "X-Request-Id" /var/log/incidents/curl-runs/run-1-09-01.curl /var/log/incidents/curl-runs/run-2-09-05.curl /var/log/incidents/curl-runs/run-3-09-09.curl
```

Listing the directory shows the three captures; reading run 2 reveals the `503` plus the `Retry-After: 5` and `upstream_unavailable` details; the multi-file greps line up status codes and request ids across all three runs so the failing id `req-9-05-fail` can be quoted in the postmortem.
