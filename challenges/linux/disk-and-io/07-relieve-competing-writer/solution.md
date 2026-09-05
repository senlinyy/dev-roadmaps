```bash
iostat -xy vdb 5 2; ps -eo pid,user,cmd
cat /proc/1600/io; lsof -p 1600
sleep 5; cat /proc/1600/io
kill -TERM 1600
iostat -xy vdb 5 2
ps -p 1500 -o pid,state,cmd
```

The post-termination samples must be newly collected; old output is not recovery evidence. The modeled I/O counters are deterministic kernel-accounting examples, not a real workload.
