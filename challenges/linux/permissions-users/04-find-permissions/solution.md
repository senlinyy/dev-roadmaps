```bash
find /opt -perm -002 -type f
find /usr/local/bin -perm -001 -type f
chmod 644 /opt/data/public.txt
ls -l /opt/data/public.txt
```

`-perm -002` finds files where the others-write bit is set. `-perm -001` finds files where the others-execute bit is set. After finding the insecure file, `chmod 644` tightens it to owner read/write and everyone else read-only.
