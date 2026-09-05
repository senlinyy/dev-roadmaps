```bash
systemctl status orders --no-pager
journalctl -u orders -b -n 20 --no-pager
ls -l /srv/orders/templates/index.html
sudo chgrp app /srv/orders/templates/index.html
sudo systemctl restart orders
systemctl status orders --no-pager
```

The application reads its template as app. Correct group ownership fixes access without widening the mode or running the service as root.
