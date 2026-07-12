```bash
cat /var/log/journal/orders-api.export
grep DATABASE_URL /var/log/journal/orders-api.export
grep "Main process exited" /var/log/journal/orders-api.export
grep "Failed with result" /var/log/journal/orders-api.export
grep "restart counter" /var/log/journal/orders-api.export
```
