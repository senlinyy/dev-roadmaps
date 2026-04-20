```bash
$ grep -r zombie /proc/
$ cat /proc/999/status
$ cat /proc/500/status
$ ps
```

The recursive grep finds PID 999 in zombie state (`Z`). Its `PPid` is 500, and reading that status file reveals the parent is `app-server`. Running `ps` confirms the zombie shows as `[defunct-worker] <defunct>` in the process listing.
