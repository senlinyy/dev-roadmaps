```bash
$ cat /etc/nginx/sites-available/docs.conf
$ ls /var/www/docs/
$ grep "/guides/getting-started" /var/log/nginx/access.log
$ echo "docs.example.com deep links need try_files $uri $uri/ /index.html" > /home/dev/reports/docs-spa-fix.note
$ cat /home/dev/reports/docs-spa-fix.note
```

The SPA shell (`index.html`) is present and assets are loading, so the content is deployed. The problem is the `try_files $uri $uri/ =404;` line: deep links like `/guides/getting-started` should fall back to `/index.html`, not hard-fail as if they were static files.
