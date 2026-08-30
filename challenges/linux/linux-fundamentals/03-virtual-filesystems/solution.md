```bash
cat /proc/4242/cmdline
readlink /proc/4242/cwd
cat /proc/4242/environ
cat /sys/block/vdb/queue/rotational
```

- `/proc/4242` exposes live state for one process.
- `/sys/block/vdb` exposes kernel-maintained information about one block device.
