```bash
$ cat /etc/logrotate.d/nginx
$ cat /etc/logrotate.d/myapp
$ ls /var/log/nginx/
```

The nginx config rotates daily with 14 days of history and compression enabled. The myapp config has three problems: `rotate 3` keeps only 3 old copies (far too few for debugging), `compress` is missing so old logs waste disk space, and `size 1G` waits until a log reaches 1 gigabyte before rotating, which can fill the disk.
