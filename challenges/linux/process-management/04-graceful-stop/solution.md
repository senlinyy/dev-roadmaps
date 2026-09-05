```bash
ps -p 510 -o pid,user,cmd
kill -TERM 510
sleep 5
ps -p 510 -o pid,stat,cmd
test ! -e /home/dev/export.lock
```

A PID-filtered ps returns status 1 when no process remains. That is the expected verification here.

