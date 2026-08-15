### storage.tf

```hcl
resource "aws_s3_bucket" "orders_archive" {
  bucket = "dp-orders-archive-prod"

  tags = {
    Service     = "orders"
    Environment = "prod"
  }
}

resource "aws_s3_bucket_versioning" "orders_archive" {
  bucket = aws_s3_bucket.orders_archive.id

  versioning_configuration {
    status = "Enabled"
  }
}
```

Separate resources mirror the provider API boundary while an attribute reference gives Terraform the dependency edge.
