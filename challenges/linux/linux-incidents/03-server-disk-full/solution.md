```bash
df -h /; df -i /
du -sh /var/log /srv/data
ps aux; lsof +L1
sudo systemctl restart logwriter
systemctl status logwriter; lsof +L1
df -h /
```

- An empty deleted-open listing returns a nonzero status because no files match.
