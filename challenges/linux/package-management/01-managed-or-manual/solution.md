```bash
dpkg -S /usr/sbin/nginx
apt show nginx-core
command -v ordersctl
```

The Nginx binary belongs to `nginx-core`, whose metadata records version `1.24.0-2ubuntu7.3` from Ubuntu. `ordersctl` resolves under `/usr/local/bin`, so the package database does not establish its source or update path.
