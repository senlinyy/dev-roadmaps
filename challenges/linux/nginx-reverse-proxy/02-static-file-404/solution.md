```bash
$ cat /etc/nginx/sites-available/legacy.conf
$ ls /var/www/legacy/
$ find /var/www/legacy -name "about.html"
$ grep " 404 " /var/log/nginx/access.log
```

`legacy.conf` roots the site at `/var/www/legacy`, which contains only `index.html`, `contact.html`, and the `assets/` directory. `find` returns nothing for `about.html`, and the access log has two `404` lines for `/about.html` — marketing's file was never deployed.
