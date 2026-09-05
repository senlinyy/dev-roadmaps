```bash
systemctl show app.service -p Environment
sudo sed -i.bak 's/LOG_LEVEL=debug/LOG_LEVEL=info/' /etc/systemd/system/app.service
sudo systemctl daemon-reload
sudo systemctl restart app.service
sleep 5
journalctl -u app.service --since "2026-09-01 10:30:00" --no-pager
```
