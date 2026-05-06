### envs/prod/main.tf

```hcl
module "orders_service" {
  source = "../../modules/orders-service"

  service_name        = "orders-api"
  environment         = var.environment
  aws_region          = var.aws_region
  replica_count       = var.replica_count
  deletion_protection = var.deletion_protection
  invoice_bucket_name = var.invoice_bucket_name
  export_bucket_name  = var.export_bucket_name
}
```

### envs/prod/terraform.tfvars

```hcl
environment         = "prod"
aws_region          = "eu-west-2"
replica_count       = 3
deletion_protection = true
invoice_bucket_name = "dp-orders-invoices-prod"
export_bucket_name  = "dp-orders-exports-prod"
```

The module wiring stays in main.tf; the values file only supplies production data.
