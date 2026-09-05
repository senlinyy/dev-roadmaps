```bash
ps -p 520 -o pid,user,stat,cmd
kill -TERM 520
sleep 5
ps -p 520 -o pid,stat,cmd
kill -KILL 520
ps -p 520 -o pid,stat,cmd
```

