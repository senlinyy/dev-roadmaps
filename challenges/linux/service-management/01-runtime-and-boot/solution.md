```bash
systemctl status orders --no-pager
sudo systemctl enable --now orders
systemctl status orders --no-pager
systemctl is-enabled orders
```

Enablement installs the target link; activation starts a process. Both checks must follow the change.
