```bash
curl -I http://portal.example.com/account/settings
sed -i 's#try_files \$uri =404#try_files $uri $uri/ /index.html#' /etc/nginx/nginx.conf
nginx -t
systemctl reload nginx
curl -I http://portal.example.com/account/settings
```

The fallback serves the SPA entry point while preserving direct file lookup first.
