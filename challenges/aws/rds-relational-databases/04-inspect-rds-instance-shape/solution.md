```bash
aws rds describe-db-instances --db-instance-identifier devpolaris-orders-prod
```

This is the first sanity check before deeper debugging. If the database is unavailable, public by accident, unencrypted, or using the wrong endpoint, the application problem is already partly explained.
