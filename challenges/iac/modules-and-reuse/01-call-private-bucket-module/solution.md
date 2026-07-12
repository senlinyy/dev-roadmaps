### main.tf

```hcl
terraform {
  required_version = ">= 1.6.0"
}

provider "aws" {
  region = "eu-west-2"
}

module "invoice_bucket" {
  source = "../../modules/private-bucket"

  bucket_name        = "dp-orders-invoices-prod"
  service            = "orders-api"
  environment        = "prod"
  owner              = "platform"
  versioning_enabled = true
}
```
