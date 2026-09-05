```bash
sudo systemctl start releases.service
journalctl -u releases.service -n 20 --no-pager
printf '%s\n' '[Unit]' 'Description=Daily release maintenance' '' '[Timer]' 'OnCalendar=*-*-* 03:30:00 UTC' 'Persistent=true' '' '[Install]' 'WantedBy=timers.target' | sudo tee /etc/systemd/system/releases.timer
sudo systemctl enable --now releases.timer
systemctl list-timers releases.timer
```

Test the finite job before scheduling it. Enabling the timer reloads its definition; --now also starts it during the current boot.
