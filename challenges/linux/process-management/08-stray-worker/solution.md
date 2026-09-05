```bash
ps -C node -o pid,ppid,user,stat,cmd
readlink /proc/610/cwd
cat /proc/610/cgroup
kill -TERM 610
ps -p 310,610 -o pid,ppid,user,stat,cmd
```

