```bash
$ cat signal-table.txt
$ cat cleanup.sh
$ grep -i "default kill" signal-table.txt
```

The signal table shows SIGKILL (9) and SIGSTOP (19) cannot be trapped. The cleanup script traps SIGTERM and SIGINT. The default `kill` signal is SIGTERM, number 15.
