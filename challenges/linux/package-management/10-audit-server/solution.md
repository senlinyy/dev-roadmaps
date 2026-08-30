```bash
dpkg -l
dpkg -S /usr/bin/curl
command -v backupctl
dpkg -S /usr/local/bin/backupctl
apt-cache policy openssl
```

The inventory records Nginx, curl, and OpenSSL as managed packages. `/usr/bin/curl` has a package owner, while `backupctl` resolves under `/usr/local/bin` and has no package record. OpenSSL has a newer candidate from `noble-security`.
