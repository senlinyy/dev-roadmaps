```bash
aws rds describe-db-snapshots --db-instance-identifier devpolaris-orders-prod
aws s3api get-bucket-versioning --bucket devpolaris-orders-exports-prod
```

Recovery planning is stronger when it checks every data shape. The database and exported objects need their own recovery evidence.
