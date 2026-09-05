```bash
cat /run/nginx.pid
sudo logrotate -f /etc/logrotate.d/nginx
sudo kill -USR1 913
sleep 5
ls -li /var/log/nginx
tail /var/log/nginx/access.log /var/log/nginx/error.log
```

The missing hook is intentional here. In the production policy from the preceding exercise, the postrotate hook performs the reopen automatically.
