```bash
apt list --upgradable
sudo apt upgrade openssl
needrestart
```

OpenSSL reaches `3.0.13-0ubuntu3.5` on disk. The restart report shows that `nginx.service` and `ssh.service` still use old library mappings, so service restarts remain part of the remediation plan.
