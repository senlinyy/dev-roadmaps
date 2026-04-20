```bash
$ df -h
$ df -i
$ du -sh /data/*
$ find /data/cache -type f
```

`df -h` shows `/data` at 78% space usage. `df -i` reveals the real problem: 95% of inodes on `/data` are consumed. `du -sh /data/*` breaks down the space per subdirectory, and `find` lists the ten small cache files responsible for the inode pressure.
