### main.tf

```hcl
moved {
  from = aws_s3_bucket.logs
  to   = aws_s3_bucket.archive
}

resource "aws_s3_bucket" "archive" {
  bucket = "dp-orders-logs-prod"
}
```

The refactor updates Terraform ownership metadata instead of scheduling a replacement.
