```bash
lsblk -i /dev/vdb
findmnt -T /var/lib/app
sudo growpart /dev/vdb 1
lsblk -i /dev/vdb
sudo xfs_growfs /var/lib/app
df -hT /var/lib/app
```

Only this authored growth target is modeled. No real partition table, provider volume, formatting, shrink operation, or LVM mutation is executed.
