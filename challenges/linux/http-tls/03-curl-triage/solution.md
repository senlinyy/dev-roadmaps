```bash
$ ls /home/dev/postmortem/curl-runs/
$ cat /home/dev/postmortem/curl-runs/run-2-09-05.txt
$ grep "< HTTP/" /home/dev/postmortem/curl-runs/run-1-09-01.txt /home/dev/postmortem/curl-runs/run-2-09-05.txt /home/dev/postmortem/curl-runs/run-3-09-09.txt
$ grep "X-Request-Id" /home/dev/postmortem/curl-runs/run-1-09-01.txt /home/dev/postmortem/curl-runs/run-2-09-05.txt /home/dev/postmortem/curl-runs/run-3-09-09.txt
```

Listing the directory shows the three captures; reading run 2 reveals the `503` plus the `Retry-After: 5` and `upstream_unavailable` details; the multi-file greps line up status codes and request ids across all three runs so the failing id `req-9-05-fail` can be quoted in the postmortem.
