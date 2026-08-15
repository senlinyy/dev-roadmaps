### variables.tf

```hcl
variable "service_name" {
  type    = string
  default = "orders"
}
```

### locals.tf

```hcl
locals {
  bucket_name = format("dp-%s-assets", var.service_name)
}
```

### main.tf

```hcl
resource "aws_s3_bucket" "assets" {
  bucket = local.bucket_name
}
```

### outputs.tf

```hcl
output "bucket_id" {
  value = aws_s3_bucket.assets.id
}
```

The final configuration keeps changeable input, derived naming, managed infrastructure, and published values in explicit roles.
