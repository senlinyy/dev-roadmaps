```bash
sudo dnf check-update
dnf info nginx
dnf repolist
rpm -qf /usr/sbin/nginx
```

The preview reports a newer Nginx build from `appstream`. Repository inventory confirms that source is enabled, and RPM ownership ties the current binary to the installed Nginx package.
