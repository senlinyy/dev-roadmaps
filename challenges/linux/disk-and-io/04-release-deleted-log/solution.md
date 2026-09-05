```bash
df -hT /; sudo du -xsh /var
sudo lsof +L1
sudo systemctl restart orders
df -hT /; sudo lsof +L1
systemctl status orders
```

An empty deleted-open listing returns status 1, matching lsof's no-match behavior. The final service status confirms the approved restart completed.
