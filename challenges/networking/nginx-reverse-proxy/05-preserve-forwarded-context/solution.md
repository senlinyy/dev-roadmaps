```bash
curl -I https://orders.example.com/orders
sed -i 's/proxy_set_header Host backend/proxy_set_header Host $host/' /etc/nginx/nginx.conf
sed -i 's/proxy_set_header X-Forwarded-Proto http/proxy_set_header X-Forwarded-Proto $scheme/' /etc/nginx/nginx.conf
nginx -t
systemctl reload nginx
curl -I https://orders.example.com/orders
```

The upstream receives the original public hostname and HTTPS scheme, so it accepts the request.
