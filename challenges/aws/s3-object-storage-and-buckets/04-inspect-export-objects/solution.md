```bash
aws s3api list-objects-v2 --bucket devpolaris-orders-exports-prod --prefix orders-api/daily/2026/05/
```

The important habit is checking the bucket and prefix together. A bucket can hold many unrelated object families, so the prefix is part of the evidence.
