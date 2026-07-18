### s3.tf

```hcl
resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-devpolaris-orders-prod-invoices"

  tags = {
    service     = "devpolaris-orders"
    environment = "prod"
    managed_by  = "terraform"
  }
}
```

The outputs expose stable caller-facing attributes with descriptions, without leaking unrelated resource internals.

### outputs.tf

```hcl
output "bucket_name" {
  description = "Name of the S3 bucket that stores generated order invoices."
  value       = aws_s3_bucket.orders_invoices.bucket
}

output "bucket_arn" {
  description = "ARN of the S3 bucket that stores generated order invoices."
  value       = aws_s3_bucket.orders_invoices.arn
}
```
