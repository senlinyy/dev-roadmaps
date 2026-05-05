```bash
aws s3api head-object --bucket devpolaris-orders-exports-prod --key orders-api/daily/2026/05/orders-2026-05-04.csv
aws s3api get-bucket-versioning --bucket devpolaris-orders-exports-prod
```

The object head tells you what this specific file looks like. Bucket versioning tells you whether overwrites and deletes have a recovery path.
