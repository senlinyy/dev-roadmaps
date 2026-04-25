```bash
$ cat /etc/nginx/conf.d/upstream.conf
$ grep "down" /etc/nginx/conf.d/upstream.conf
$ grep -c "upstream=10.0.0.10" /var/log/nginx/upstream-access.log
$ grep -c "upstream=10.0.0.12" /var/log/nginx/upstream-access.log
$ grep "upstream=10.0.0.11" /var/log/nginx/upstream-access.log
```

The pool weights `10.0.0.10` at 3 and `10.0.0.12` at 1, with `10.0.0.11 down` excluded entirely. The access log confirms that distribution (7 vs 2 in this window) and zero hits to 10.0.0.11, so the lopsided load isn't a bug, it's the configured weight, and 10.0.0.11 is gone on purpose.
