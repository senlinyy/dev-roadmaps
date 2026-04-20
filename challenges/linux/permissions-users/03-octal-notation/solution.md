```bash
chmod 644 /var/www/index.html
chmod 755 /var/www/uploads
chmod 640 /var/www/config/db.conf
chmod 750 /var/www/scripts/backup.sh
ls -l /var/www
ls -l /var/www/config
ls -l /var/www/scripts
```

644 = `rw-r--r--`, 755 = `rwxr-xr-x`, 640 = `rw-r-----`, 750 = `rwxr-x---`. Each digit maps to a triplet: 4=read, 2=write, 1=execute, summed together.
