```bash
df -h /
df -i /
find /var/cache/sessions -type f | wc -l
```

- Free byte capacity does not guarantee that the filesystem has free inodes.
- Every tiny session file consumes an inode even when it consumes very little data.
