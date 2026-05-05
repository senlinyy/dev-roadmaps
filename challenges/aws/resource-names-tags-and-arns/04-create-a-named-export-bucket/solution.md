```bash
aws s3api create-bucket --bucket devpolaris-orders-exports-prod --region us-east-1
aws s3api get-bucket-location --bucket devpolaris-orders-exports-prod
```

The bucket name is human-readable inventory. The location check proves you are looking at the resource where you expected it to live.
