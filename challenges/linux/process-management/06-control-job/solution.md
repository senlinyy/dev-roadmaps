```bash
sleep 300 &
jobs -l
fg %1
<Ctrl+Z>
bg %1
fg %1
<Ctrl+C>
ps -p $! -o pid,stat,cmd
```

Ctrl+Z suspends the foreground job; Ctrl+C interrupts it. Sleep time advances only through foreground sleep commands in this deterministic lab.

