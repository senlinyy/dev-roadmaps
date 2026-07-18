### main.tf

```hcl
provider "aws" {
  region = "eu-west-2"
}

resource "aws_s3_bucket" "orders_invoices" {
  bucket = "dp-orders-invoices-prod"

  tags = {
    service     = "orders-api"
    environment = "prod"
    owner       = "platform"
  }
}
```

The resource block records the intended managed shape before import, giving the first post-import plan a configuration to compare with the real bucket.
