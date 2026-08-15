### network.tf

```hcl
data "aws_vpc" "platform" {
  tags = {
    Name = "platform-prod"
  }
}

resource "aws_subnet" "orders" {
  vpc_id    = data.aws_vpc.platform.id
  cidr_block = "10.42.20.0/24"
}
```

The data source preserves the ownership boundary while still giving the subnet a concrete dependency on the existing VPC.
