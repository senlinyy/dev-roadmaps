```bash
ls -l /etc
ls -l /opt/deploy
cat /home/dev/report.txt
```

`ls -l` shows the full permission string. `/etc/passwd` has `rw-r--r--` (644), readable by everyone. `/etc/shadow` has `rw-------` (600), readable only by root. `deploy.sh` has `rwxr-x---` (750), executable by owner and group.
