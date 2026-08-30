```bash
apt-cache policy nginx
dpkg -S /usr/sbin/nginx
apt list --upgradable
```

APT would select `1.24.0-2ubuntu7.3` from `noble-updates`, while `1.24.0-2ubuntu7.2` is installed. The binary belongs to the managed `nginx` package, and no upgrade is performed during inspection.
