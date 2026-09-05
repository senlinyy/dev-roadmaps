```bash
curl -I https://checkout.example.com/health
sed -i 's/proxy_set_header Host backend/proxy_set_header Host $host/' /etc/nginx/nginx.conf
sed -i 's/proxy_set_header X-Forwarded-Proto http/proxy_set_header X-Forwarded-Proto $scheme/' /etc/nginx/nginx.conf
nginx -t
systemctl reload nginx
curl -I https://checkout.example.com/health
```

The tested and reloaded proxy now preserves public request context, and the upstream returns a healthy response.
