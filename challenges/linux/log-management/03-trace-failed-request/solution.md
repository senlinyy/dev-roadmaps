```bash
awk '{count[$9]++} END {for (code in count) print code, count[code]}' /var/log/nginx/access.log | sort
grep ' 502 ' /var/log/nginx/access.log
grep req_8K9 /var/log/nginx/error.log
grep req_8K9 /var/log/app/app.jsonl
```
