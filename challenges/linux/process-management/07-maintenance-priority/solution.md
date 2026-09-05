```bash
nice -n 10 backup-worker --once &
renice 15 -p $!
ionice -c2 -n7 -p $!
ps -p $! -o pid,ni,stat,cmd
ionice -p $!
```

