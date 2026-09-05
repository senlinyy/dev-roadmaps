```bash
readlink /proc/310/exe
readlink /proc/310/cwd
sudo cat /proc/310/environ | tr '\0' '\n' | grep '^NODE_ENV='
cat /proc/310/limits
sudo ls -l /proc/310/fd
```

Only NODE_ENV reaches the terminal; the other environment entries stay inside the pipeline.

