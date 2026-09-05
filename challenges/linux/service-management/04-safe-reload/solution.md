```bash
sudo cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
sudo sed -i 's/:3000;/:4000;/' /etc/nginx/nginx.conf
sudo nginx -t
sudo systemctl reload nginx
systemctl status nginx
```

Nginx adopts the tested candidate through reload. The backup retains the previously active proxy destination.
