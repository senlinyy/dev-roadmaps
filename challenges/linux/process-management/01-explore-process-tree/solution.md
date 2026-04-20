```bash
$ cat /proc/1/status
$ cat /proc/215/status
$ cat /proc/108/status
$ cat /proc/42/status
$ grep PPid /proc/42/status
```

PID 215 (node) has PPid 108 (bash), which has PPid 42 (sshd), which has PPid 1 (init). The `grep` confirms sshd's parent is PID 1, completing the chain.
