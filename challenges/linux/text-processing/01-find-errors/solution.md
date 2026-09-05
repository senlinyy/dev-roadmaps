```bash
head -n 2 /var/log/orders/app.log
tail -n 2 /var/log/orders/app.log
grep -inE '^[^ ]+ error ' /var/log/orders/app.log
grep -nF -C 1 'request_id=req.42' /var/log/orders/app.log
```

The severity search excludes the INFO message about an error budget. Fixed-string matching prevents the dot from selecting the unrelated request.
