```bash
systemctl status rsyslog
journalctl -u rsyslog -n 20 --no-pager
sudo du -sh /var/spool/rsyslog
logger -t shipping-probe "devpolaris shipping probe 20260901"
journalctl --since "1 minute ago" SYSLOG_IDENTIFIER=shipping-probe --no-pager
```
