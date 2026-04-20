```bash
$ find /etc -name "*.conf"
$ find /var/log -name "*.log"
$ tree -L 2 /etc
$ find /var -type f -size +1M
```

`find` walks the directory tree in real time, matching by `-name`, `-type`, `-size`, and many other criteria. `-name "*.conf"` uses a glob pattern. `-size +1M` matches files larger than one megabyte. `tree -L 2` limits the visual depth to keep the output manageable.
