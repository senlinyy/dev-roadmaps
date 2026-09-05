```bash
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.bak
nginx -t
vim /etc/nginx/nginx.conf
```

In Normal mode, press `10GA`, type `;`, then press `Esc`. Enter `:wq` and press `Enter`.

```bash
nginx -t
systemctl reload nginx
systemctl status nginx
```

The first test fails. The repaired saved config passes, and only then is it reloaded.
