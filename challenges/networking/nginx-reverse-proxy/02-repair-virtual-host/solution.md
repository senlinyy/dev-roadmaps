```bash
curl -I http://app.example.com/health
sed -i 's/old-app.example.com/app.example.com/' /etc/nginx/nginx.conf
nginx -t
systemctl reload nginx
systemctl status nginx
curl -I http://app.example.com/health
```

The corrected Host match selects the proxying server, and the final request returns the upstream health response.
