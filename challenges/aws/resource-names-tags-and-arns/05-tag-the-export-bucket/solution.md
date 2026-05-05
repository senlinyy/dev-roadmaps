```bash
aws s3api put-bucket-tagging --bucket devpolaris-orders-exports-prod --tagging 'TagSet=[{Key=service,Value=devpolaris-orders-api},{Key=env,Value=prod},{Key=owner,Value=orders}]'
aws s3api get-bucket-tagging --bucket devpolaris-orders-exports-prod
```

Tags do not grant access by themselves. They make ownership, cost, cleanup, and review conversations much easier.
