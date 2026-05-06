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

The resource block gives Terraform an address for the existing bucket before any import mapping changes state.
