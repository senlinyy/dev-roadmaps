```bash
printf '%s\n' '[Unit]' 'Description=Orders API' '' '[Service]' 'Type=simple' 'User=app' 'Group=app' 'WorkingDirectory=/srv/orders' 'EnvironmentFile=/etc/orders/app.env' 'ExecStart=/usr/bin/node /srv/orders/server.js' '' '[Install]' 'WantedBy=multi-user.target' | sudo tee /etc/systemd/system/orders.service
sudo systemctl daemon-reload
sudo systemctl start orders
systemctl status orders --no-pager
systemctl show orders -p MainPID -p User -p WorkingDirectory
```

The service starts from its loaded unit, with the declared account, directory, and environment source.
