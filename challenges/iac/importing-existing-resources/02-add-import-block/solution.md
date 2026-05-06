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

### imports.tf

```hcl
import {
  to = aws_s3_bucket.orders_invoices
  id = "dp-orders-invoices-prod"
}
```

The import block records the adoption mapping in code review while the resource block describes the object Terraform will own.
