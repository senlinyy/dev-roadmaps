A clean run looks like this:

```bash
$ echo "ok"
ok
$ echo $?
0
$ cat /no/such/file
cat: /no/such/file: No such file or directory
$ echo $?
1
$ mkdir -p /home/dev/logs && echo "started" > /home/dev/logs/app.log
$ cat /home/dev/missing.txt || echo "File not found, using defaults"
File not found, using defaults
```

`echo $?` prints the exit code of the preceding command. The `&&` operator only runs the second command if the first succeeded (mkdir returns 0). The `||` operator only runs the second command if the first failed (cat returns non-zero for a missing file).
