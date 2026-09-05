```bash
systemctl cat orders
printf '%s\n' '[Service]' 'EnvironmentFile=' 'EnvironmentFile=/etc/orders/release.env' | sudo tee /etc/systemd/system/orders.service.d/override.conf
sudo systemctl daemon-reload
sudo systemctl restart orders
systemctl show orders -p EnvironmentFiles -p MainPID
bash -c 'pid=$(systemctl show -p MainPID --value orders); sudo cat /proc/$pid/environ | tr "\0" "\n"'
```

The drop-in replaces the environment source. The new process, not the old PID, must receive the new values.
