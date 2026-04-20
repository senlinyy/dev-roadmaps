```bash
$ cat /etc/fstab
$ grep swap /etc/fstab
$ df -T
$ grep nfs /etc/fstab
```

`cat /etc/fstab` shows all entries including the commented-out NFS mount. The swap line uses a UUID instead of a device path. `df -T` confirms `ext4` and `xfs` are the active filesystem types. `grep nfs /etc/fstab` finds the disabled NFS share line.
