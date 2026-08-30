```bash
sudo apt remove nginx
ls /etc/nginx
sudo apt purge nginx
find /etc/nginx -type f
```

Ordinary removal deletes `/usr/sbin/nginx` but retains `nginx.conf`. Purging the residual package state then removes that configuration file as well.
