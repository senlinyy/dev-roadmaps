```bash
umask
umask 027
touch /home/dev/report.txt
mkdir /home/dev/reports
stat /home/dev/report.txt /home/dev/reports
```

Mask `0027` removes group write and every permission for others. Applied to the normal bases, it creates the file as `0640` and the directory as `0750`.
