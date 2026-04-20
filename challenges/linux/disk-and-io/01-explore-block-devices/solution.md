```bash
$ lsblk
$ cat /etc/fstab
$ df -h
$ grep noatime /etc/fstab
```

`lsblk` shows `sda` and `sdb` with their partitions. `/etc/fstab` reveals that `/data` uses `xfs` with the `noatime` mount option. `df -h` confirms the live usage of each mount point.
