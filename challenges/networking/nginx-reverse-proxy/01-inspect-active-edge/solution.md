```bash
systemctl status nginx
ss -lntp sport = :80
cat /etc/nginx/nginx.conf
nginx -t
curl -I http://edge.example.com/health
```

The service is active, owns port 80, the saved file validates, and the authored edge response is healthy.
