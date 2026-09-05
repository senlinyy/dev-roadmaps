```bash
journalctl -u orders -b --since '10 minutes ago' --no-pager
sudo sed -i 's|^DATABASE_URL=.*|DATABASE_URL=postgres://orders@db.internal/orders|' /etc/orders/app.env
sudo systemctl reset-failed orders
sudo systemctl start orders
sleep 10
systemctl show orders -p ActiveState -p Result -p Restart -p RestartUSec -p NRestarts
```

The repaired process starts successfully without relaxing retry limits. Resetting failure state alone would start the same broken configuration again.
