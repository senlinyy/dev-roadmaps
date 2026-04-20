```bash
$ df -hT
$ du -sh /var/log
$ du -sh /var/*
$ df -i
$ df -i /
```

`df` reports filesystem-level usage: `-h` for human sizes, `-T` for type. `du` measures directory sizes: `-s` summarizes, `-h` for human sizes. `df -i` shows inode usage. It is useful when "No space left" errors appear but `df` shows plenty of free space. Append a path like `/` to scope `df` to a single mount.
