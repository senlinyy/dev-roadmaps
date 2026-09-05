```bash
curl -I http://api.example.com/api/orders
sed -i 's#http://backend:9000/api/#http://backend:9000/#' /etc/nginx/nginx.conf
nginx -t
systemctl reload nginx
curl -I http://api.example.com/api/orders
```

The corrected trailing-slash form replaces `/api/` and forwards `/orders`.
