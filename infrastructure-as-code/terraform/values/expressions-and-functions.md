---
title: "Expressions and Functions"
description: "Use Terraform's built-in expressions and functions to compute, transform, and query values inside your configurations."
overview: "Terraform is not just a list of resource declarations — it has a complete expression language for computing values. This article covers the most important expressions and built-in functions: string formatting, conditionals, for expressions, and the collection and string functions you will use constantly."
tags: ["expressions", "functions", "hcl", "for", "terraform"]
order: 4
id: article-iac-terraform-values-expressions
---

## Table of Contents

1. [Expressions Are Everywhere](#expressions-are-everywhere)
2. [String Interpolation and Templating](#string-interpolation-and-templating)
3. [Conditional Expressions](#conditional-expressions)
4. [For Expressions](#for-expressions)
5. [Splat Expressions](#splat-expressions)
6. [Essential Collection Functions](#essential-collection-functions)
7. [Essential String Functions](#essential-string-functions)
8. [Essential Numeric and Type Functions](#essential-numeric-and-type-functions)
9. [The jsonencode Function](#the-jsonencode-function)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## Expressions Are Everywhere

In Terraform, the right-hand side of almost any assignment is an expression. The instance type in a resource block is an expression. The value of a local is an expression. The condition in a `count` argument is an expression. An expression can be as simple as a string literal (`"t3.small"`) or as complex as a multi-line `for` expression that filters and transforms a list.

![Expressions combine inputs and references into values that may be known now or only after apply.](/content-assets/articles/article-iac-terraform-values-expressions/expression-evaluation.png)

Understanding expressions is what separates a configuration that just works for one specific case from one that handles many cases gracefully. Instead of creating a separate configuration for each variation, you use expressions to compute the right value from the inputs you have been given.

Terraform's expression language is intentionally limited — it is not a full programming language. There are no loops in the imperative sense, no mutable variables, no function definitions. This limitation is a deliberate design choice: it keeps configurations declarative and predictable. Everything you can do with expressions produces a value. There are no side effects.

## String Interpolation and Templating

The most common expression you will write is a string interpolation. You embed a reference or expression inside a string using the `${...}` syntax:

```hcl
locals {
  bucket_name = "${var.project}-${var.environment}-uploads"
  log_prefix  = "${var.environment}/${var.region}/"
}
```

Inside the braces, you can use any expression — a variable reference, a resource attribute, a function call, or even a conditional. The result of the expression is converted to a string and inserted at that position.

For multi-line string content, Terraform supports heredoc syntax:

```hcl
locals {
  startup_script = <<-EOT
    #!/bin/bash
    echo "Starting ${var.environment} environment"
    aws s3 cp s3://${var.config_bucket}/config.json /etc/app/config.json
  EOT
}
```

The `<<-EOT` heredoc strips leading whitespace from each line, so you can indent the content neatly inside the locals block. The `EOT` at the end marks where the string ends. This is useful for user-data scripts, policy documents, and any other multi-line text content.

A shorthand for simple single-value references: if the entire expression is just a reference with no surrounding text, you do not need the interpolation syntax at all. `instance_type = var.instance_type` is cleaner than `instance_type = "${var.instance_type}"`. The interpolation syntax is only needed when you are combining a reference with surrounding text.

## Conditional Expressions

A conditional expression picks one value or another based on a boolean condition. The syntax follows the same pattern as a ternary operator in most programming languages: `condition ? value_if_true : value_if_false`.

```hcl
locals {
  instance_type = var.environment == "prod" ? "t3.medium" : "t3.micro"
  min_instances = var.environment == "prod" ? 2 : 1
  enable_https  = var.environment != "dev"
}
```

The condition can be any expression that evaluates to `true` or `false`. Common conditions include equality checks (`==`), inequality checks (`!=`), comparison operators (`>`, `<`, `>=`, `<=`), and logical operators (`&&`, `||`, `!`).

Both branches should produce the same type, or values Terraform can safely convert to a common type. For example, `"2"` and `1` can be converted to strings, but relying on that conversion makes the configuration harder to read. Prefer writing both branches as the type you actually want.

Conditionals are also used to control whether a resource is created at all:

```hcl
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  count = var.enable_monitoring ? 1 : 0

  alarm_name          = "${local.name_prefix}-high-cpu"
  comparison_operator = "GreaterThanThreshold"
  threshold           = 80
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = 300
  statistic           = "Average"
}
```

When `var.enable_monitoring` is `true`, `count` is `1` and the alarm is created. When it is `false`, `count` is `0` and no alarm is created. This is the standard Terraform pattern for optional resources.

## For Expressions

A `for` expression transforms a list, set, or map into a new list or map by applying an expression to each element. The syntax might look unusual at first, but it follows a consistent pattern.

To transform a list into another list, you write:

```hcl
[for item in some_list : transformed_item]
```

For example, to uppercase all values in a list of availability zones:

```hcl
locals {
  upper_zones = [for z in var.availability_zones : upper(z)]
}
```

To filter a list, you add an `if` condition:

```hcl
locals {
  prod_instances = [for i in var.instances : i if i.environment == "prod"]
}
```

To transform a list into a map, you use braces instead of brackets and provide a key:

```hcl
locals {
  instance_by_name = { for i in var.instances : i.name => i.id }
}
```

This produces a map where each instance's name is the key and its ID is the value.

For expressions over maps work similarly, but you get access to both the key and the value:

```hcl
locals {
  uppercased_tags = { for k, v in var.tags : upper(k) => upper(v) }
}
```

This takes a map of tags and produces a new map with all keys and values uppercased.

A practical example: suppose you have a list of objects, each describing a subnet, and you need to extract just the IDs into a list to pass to a resource:

```hcl
locals {
  subnet_ids = [for s in aws_subnet.web : s.id]
}
```

When `aws_subnet.web` is created with `count`, it becomes a list of subnet objects. The `for` expression extracts just the `id` attribute from each one. The next section covers a shorthand for this specific pattern.

## Splat Expressions

The splat expression is a shorthand for `for` expressions that extract one attribute from every element in a list. Instead of writing `[for s in aws_subnet.web : s.id]`, you write:

```hcl
locals {
  subnet_ids = aws_subnet.web[*].id
}
```

The `[*]` is the splat operator. It means "give me this attribute from every element in the list." This is equivalent to the `for` expression but more concise for simple cases.

Splat expressions work with list-like collections: lists, sets, and tuples. They do not work directly with maps or objects. For more complex transformations, such as filtering, computing derived values, or preserving map keys, use a full `for` expression.

Use this rule of thumb:

| Need | Best expression |
| --- | --- |
| Extract one attribute from every counted resource | Splat, such as `aws_instance.app[*].id` |
| Filter a collection | `for` expression with `if` |
| Preserve or create map keys | `for` expression with `{ key => value }` |
| Transform a map or object | `for` expression |

A common use is collecting all IDs from resources created with `count`:

```hcl
resource "aws_security_group" "allow_web" {
  count  = length(var.web_ports)
  name   = "allow-web-${var.web_ports[count.index]}"
  vpc_id = aws_vpc.main.id
}

output "security_group_ids" {
  value = aws_security_group.allow_web[*].id
}
```

The output collects all security group IDs into a list automatically, regardless of how many were created.

## Essential Collection Functions

Terraform's built-in functions handle the most common list and map operations. You do not need to write complex logic for these — the functions are there.

![Terraform functions transform raw strings, lists, maps, and JSON documents into resource arguments.](/content-assets/articles/article-iac-terraform-values-expressions/function-transform-path.png)

**`length(collection)`** returns the number of elements in a list, set, or map:
```hcl
count = length(var.availability_zones)
```

**`merge(map1, map2, ...)`** combines multiple maps into one. Later maps override earlier ones if they share a key. Essential for tag management:
```hcl
tags = merge(local.common_tags, { Name = "app-server" })
```

**`concat(list1, list2, ...)`** combines multiple lists into one:
```hcl
all_subnet_ids = concat(local.web_subnet_ids, local.db_subnet_ids)
```

**`flatten(list_of_lists)`** turns a list of lists into a single flat list:
```hcl
all_cidrs = flatten([local.web_cidrs, local.db_cidrs])
```

**`distinct(list)`** removes duplicate values from a list:
```hcl
unique_regions = distinct(var.all_regions)
```

**`contains(list, value)`** checks whether a list contains a specific value. Returns `true` or `false`:
```hcl
validation {
  condition     = contains(["dev", "staging", "prod"], var.environment)
  error_message = "Environment must be dev, staging, or prod."
}
```

**`keys(map)` and `values(map)`** extract the keys or values of a map as a list:
```hcl
locals {
  tag_keys   = keys(var.tags)
  tag_values = values(var.tags)
}
```

**`lookup(map, key, default)`** retrieves a value from a map by key, returning a default if the key is not present:
```hcl
instance_type = lookup(var.instance_types_by_env, var.environment, "t3.micro")
```

**`toset(list)` and `tolist(set)`** convert between list and set types:
```hcl
zone_set = toset(var.availability_zones)
```

## Essential String Functions

String functions handle the text manipulation that comes up constantly when building resource names, constructing ARNs, and processing input values.

**`format(pattern, values...)`** formats a string using printf-style placeholders:
```hcl
name = format("%s-%s-%03d", var.project, var.environment, count.index + 1)
```

**`formatlist(pattern, values)`** applies `format` to each element in a list:
```hcl
instance_names = formatlist("app-server-%02d", range(1, var.instance_count + 1))
```

**`join(separator, list)`** concatenates a list of strings with a separator between each element:
```hcl
cidr_list = join(", ", var.allowed_cidrs)
```

**`split(separator, string)`** splits a string into a list:
```hcl
parts = split("-", var.resource_name)
```

**`replace(string, search, replacement)`** replaces occurrences of one string with another:
```hcl
safe_name = replace(var.project_name, " ", "-")
```

**`lower(string)` and `upper(string)`** convert to lowercase or uppercase:
```hcl
env_lower = lower(var.environment)
```

**`trimspace(string)`** removes leading and trailing whitespace:
```hcl
clean_input = trimspace(var.user_input)
```

**`substr(string, offset, length)`** extracts a portion of a string:
```hcl
short_region = substr(var.region, 0, 2)
```

## Essential Numeric and Type Functions

**`max(numbers...)` and `min(numbers...)`** return the highest or lowest value from a set of numbers:
```hcl
max_size = max(var.min_instances * 2, 4)
```

**`ceil(number)` and `floor(number)`** round up or down to the nearest integer:
```hcl
shard_count = ceil(var.record_count / 1000)
```

**`range(start, end)` or `range(end)`** generates a sequence of integers. Useful with `for` expressions to create numbered resources:
```hcl
instance_suffixes = range(1, var.instance_count + 1)
```

**`tostring(value)` and `tonumber(value)` and `tobool(value)`** explicitly convert between types when Terraform cannot infer the conversion automatically:
```hcl
port_string = tostring(var.port)
```

**`can(expression)`** returns `true` if the expression evaluates without error, `false` otherwise. Useful in validation rules to test whether an expression is valid:
```hcl
is_valid_cidr = can(cidrhost(var.cidr_block, 0))
```

## The jsonencode Function

The `jsonencode` function converts a Terraform value — a string, a number, a list, a map, or a nested object — into its JSON string representation. This is indispensable for writing IAM policies, Lambda environment variable JSON, and any other resource that requires a JSON string attribute.

Without `jsonencode`, you would write IAM policies as heredoc strings with manual JSON formatting:

```hcl
policy = <<-EOT
  {
    "Version": "2012-10-17",
    "Statement": [
      {
        "Effect": "Allow",
        "Action": ["s3:GetObject"],
        "Resource": "arn:aws:s3:::${var.bucket_name}/*"
      }
    ]
  }
EOT
```

This works but is fragile — formatting mistakes create invalid JSON, and interpolating dynamic values requires careful quoting. With `jsonencode`, you write the policy as a native Terraform map:

```hcl
policy = jsonencode({
  Version = "2012-10-17"
  Statement = [
    {
      Effect   = "Allow"
      Action   = ["s3:GetObject"]
      Resource = "arn:aws:s3:::${var.bucket_name}/*"
    }
  ]
})
```

This is more readable, correctly formatted, and handles interpolation naturally. Terraform validates the structure at plan time, and `jsonencode` guarantees the output is valid JSON. The inverse function, `jsondecode`, parses a JSON string back into a Terraform value — useful when reading JSON configuration from a data source.

## Putting It All Together

A configuration that uses expressions effectively is dramatically more reusable than one that relies on hardcoded values. The same configuration can create one instance in development and four in production by reading `var.instance_count`. It can pick the right instance type per environment using a conditional. It can generate a correctly formatted list of security group IDs using a splat expression. It can construct a valid IAM policy document using `jsonencode`.

The expression layer — string interpolation, conditionals, `for` expressions, and built-in functions — is what makes Terraform more than a static configuration file. It gives you the tools to compute the right values from the inputs you have, handle common variations gracefully, and avoid repeating yourself across environments and modules.

## What's Next

You now have the complete picture of Terraform's values layer: input variables bring external information in, local values compute intermediate results, output values send information back out, and expressions transform everything in between. The next module covers environments and security: how to organize your configuration files to cleanly separate development, staging, and production, and how to handle secrets safely.


![Expressions and functions summary: reference, transform, filter, and encode values before resource arguments use them.](/content-assets/articles/article-iac-terraform-values-expressions/expressions-summary.png)

---

**References**

- [Expressions (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions) — The full reference for all expression types, including types, operators, and splat expressions.
- [Built-in Functions (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/functions) — A complete listing of all built-in functions with examples for each.
- [For Expressions (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/expressions/for) — Detailed reference for the `for` expression syntax, including filtering and map construction.
