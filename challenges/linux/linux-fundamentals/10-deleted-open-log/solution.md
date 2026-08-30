```bash
df -h /
du -sh /var/log
lsof +L1
```

- `node` process `4242` still holds `/var/log/orders-api.log (deleted)` open.
- The data remains allocated until that final open reference is released.
