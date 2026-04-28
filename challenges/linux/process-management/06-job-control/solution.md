```bash
$ grep State /proc/*/status
$ cat /proc/310/status
$ cat /proc/310/environ
```

PID 310 (python3) is in state `T (stopped)`, started by bash (PID 88). The `environ` file records `STOP_SIGNAL=SIGTSTP`, which is the signal sent by Ctrl+Z.
