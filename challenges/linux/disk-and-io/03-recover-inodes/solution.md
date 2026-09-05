```bash
df -hT /var/lib/app
df -i /var/lib/app
find /var/lib/app/cache -xdev -type f
sudo rm -r /var/lib/app/cache/expired
df -i /var/lib/app
```

The fixture models a small number of real virtual inodes, not an invented claim that ten files represent millions.
