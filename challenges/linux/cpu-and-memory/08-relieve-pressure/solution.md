```bash
free -h; vmstat 5 3
ps -eo pid,user,rss,cmd --sort=-rss
kill -TERM 1600
free -h; vmstat 5 3
ps -p 1500 -o pid,state,cmd
```

Only the authored export exit changes this scenario's resource snapshot; there is no general scheduler or memory allocator.
