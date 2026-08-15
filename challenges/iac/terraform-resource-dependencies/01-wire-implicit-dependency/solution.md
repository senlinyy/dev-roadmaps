### lambda.tf

```hcl
resource "aws_iam_role" "orders_runtime" {
  name = "orders-runtime"
}

resource "aws_lambda_function" "orders" {
  function_name = local.function_name
  role          = aws_iam_role.orders_runtime.arn
  filename      = "function.zip"
}
```

Terraform can now order role creation before function configuration without an unnecessary explicit dependency.
