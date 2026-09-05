```bash
df -hT /
sudo du -xh --max-depth=1 /var
sudo find /var/cache/releases -xdev -type f -size +1G
sudo rm /var/cache/releases/expired-build.tar
df -hT /
```

The single-filesystem flags prevent data on the separate application mount from being counted as root usage.
