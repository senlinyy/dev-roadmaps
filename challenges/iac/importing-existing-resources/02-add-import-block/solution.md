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

The import block maps the existing bucket identifier to one Terraform address without creating a second managed object.

### imports.tf

```hcl
import {
  to = aws_s3_bucket.orders_invoices
  id = "dp-orders-invoices-prod"
}
```
