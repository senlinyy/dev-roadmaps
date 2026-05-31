---
title: "Output Values"
description: "Expose important information from your Terraform configuration so operators and other modules can use it."
overview: "Outputs are how a Terraform configuration or module surfaces results, IP addresses, DNS names, resource IDs, ARNs, to the outside world. This article explains how to declare outputs, how to reference them between modules, how to protect sensitive outputs, and how to query outputs after an apply."
tags: ["outputs", "output values", "modules", "terraform", "hcl"]
order: 3
id: article-iac-terraform-values-outputs
---

## Table of Contents

1. [What Outputs Are For](#what-outputs-are-for)
2. [Declaring an Output](#declaring-an-output)
3. [Viewing Outputs After an Apply](#viewing-outputs-after-an-apply)
4. [Sensitive Outputs](#sensitive-outputs)
5. [Using Module Outputs in the Root Configuration](#using-module-outputs-in-the-root-configuration)
6. [Passing Outputs Between Root Configurations](#passing-outputs-between-root-configurations)
7. [What to Output and What to Leave Private](#what-to-output-and-what-to-leave-private)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Outputs Are For

A Terraform output is an exported value from a module or root configuration that other humans, tooling, or modules can read after evaluation.

When `terraform apply` finishes, the infrastructure exists, but you often need specific pieces of information about what was just created. What is the load balancer's DNS name so you can create a CNAME record? What is the RDS database's connection endpoint? What is the auto-scaling group's name so you can configure a monitoring alert?

![Output values expose selected facts across the boundary between resources, callers, and automation.](/content-assets/articles/article-iac-terraform-values-outputs/output-boundary.png)

Without outputs, you would have to log into the AWS console and hunt for these values manually after every apply. Outputs let you declare exactly which values are important and have Terraform surface them automatically at the end of every apply.

Outputs also serve a second purpose: they are the mechanism by which one Terraform module passes information to another. A network module that creates a VPC and subnets needs to hand the VPC ID and subnet IDs to a database module that places an RDS instance inside that network. Outputs are how that handoff happens. The network module declares the VPC ID as an output. The root configuration references `module.network.vpc_id` and passes it as an input to the database module.

Without outputs, modules would be isolated, each one creating resources but unable to share the results of those resources with anything else. Outputs are what turn a collection of independent modules into a connected system.

## Declaring an Output

An output block names one value Terraform should expose after evaluation. The `value` expression can read a resource attribute, a module output, or a computed expression. Example: `output "load_balancer_dns"` can expose `aws_lb.main.dns_name` so an operator knows what DNS record to create.

Outputs are declared with `output` blocks, typically in a file called `outputs.tf`:

```hcl
output "load_balancer_dns" {
  value       = aws_lb.main.dns_name
  description = "The DNS name of the application load balancer. Point your domain CNAME record here."
}

output "vpc_id" {
  value       = aws_vpc.main.id
  description = "The ID of the VPC. Pass this to modules that need to place resources inside the network."
}

output "db_endpoint" {
  value       = aws_db_instance.main.endpoint
  description = "The connection endpoint for the RDS database in host:port format."
}
```

Each `output` block has a label (the output name) and a `value` attribute containing any valid Terraform expression. The expression most commonly references an attribute of a resource created in the same configuration, but it can also be a computed value, a string interpolation, a function call, or a conditional expression.

The `description` attribute explains what the output represents and how a caller should use it. Like variable descriptions, this is documentation that saves everyone time.

The label you give an output becomes the key you use to reference it from outside the configuration. If you name an output `vpc_id`, callers reference it as `module.<module_name>.vpc_id` (when inside a module) or view it with `terraform output vpc_id` (when it is a root-level output).

## Viewing Outputs After an Apply

Root-level outputs are the outputs declared in the directory where you run Terraform. Terraform prints them after `apply` because they are meant for operators and automation outside the module. Example: a deployment can print `load_balancer_dns` so a DNS script can read it with `terraform output -raw load_balancer_dns`.

Root-level outputs, outputs declared in the root configuration rather than inside a child module, are printed automatically at the end of a successful `terraform apply`:

```
Apply complete! Resources: 3 added, 0 changed, 0 destroyed.

Outputs:

load_balancer_dns = "my-app-1234567890.us-east-1.elb.amazonaws.com"
vpc_id = "vpc-0abc123def456789"
db_endpoint = <sensitive>
```

Sensitive outputs show `<sensitive>` instead of their value in this summary.

After an apply, you can query outputs at any time with the `terraform output` command:

```bash
# Show all outputs
terraform output

# Show a specific output
terraform output load_balancer_dns

# Show a sensitive string output as raw text (reveals the value)
terraform output -raw db_password

# Output as raw text (no quotes, useful for shell scripting)
terraform output -raw load_balancer_dns

# Output as JSON (useful for scripts that parse the results)
terraform output -json
```

The `terraform output` command reads from the state file. It does not contact cloud APIs by itself. It shows the values stored during the last apply or state refresh. If someone made a change outside of Terraform that modified one of these values, such as a load balancer being replaced with a different DNS name, the output can remain stale until you run a plan or apply that refreshes state.

The `-raw` flag is particularly useful in automation scripts. It strips the surrounding quotes and newline from string outputs, making it easy to use a Terraform output directly in a shell variable:

```bash
LB_DNS=$(terraform output -raw load_balancer_dns)
echo "Configuring DNS CNAME record pointing to ${LB_DNS}"
```

## Sensitive Outputs

A sensitive output is still available to Terraform, but Terraform hides it from normal human-readable output. Use it when an output contains a password, token, private key, or full connection string that should not be printed casually. Example: `db_password` should be sensitive; an ordinary database hostname is often not secret by itself, though some teams still treat private endpoints as internal information.

Mark an output as sensitive when its value should not appear in terminal output or CI/CD logs:

![Sensitive outputs redact display values while still requiring careful handling because state can store the real value.](/content-assets/articles/article-iac-terraform-values-outputs/sensitive-output-flow.png)

```hcl
output "db_password" {
  value     = random_password.db.result
  sensitive = true
}

output "db_endpoint" {
  value     = aws_db_instance.main.endpoint
}
```

In `terraform apply` output, in the plain `terraform output` listing, and in any plan or apply logs, sensitive outputs appear as `<sensitive>`. The actual value is hidden.

However, the value is still accessible. Running `terraform output -raw db_password` for a sensitive string output reveals the value, and the `-json` flag also includes sensitive values for tools that parse output. The sensitive marking is a guardrail against accidental display, not a hard encryption wall.

When a module output is sensitive, any configuration that references it inherits the sensitivity. If `module.database.db_password` is a sensitive output, using it in another resource's attribute makes that attribute sensitive too, Terraform will hide it in plan output even without you explicitly marking anything in the calling configuration.

## Using Module Outputs in the Root Configuration

Module outputs are the handoff points between reusable modules. One module creates something, exposes the necessary ID or address, and another module accepts that value as an input. Example: `module.network.vpc_id` can feed the `vpc_id` variable of a database module.

The most important use of outputs is passing information between modules in the root configuration. When the root configuration chains multiple modules, each module's outputs become the inputs for downstream modules.

Here is a complete example that wires a network module, a database module, and a compute module together using outputs:

```hcl
module "network" {
  source = "./modules/network"

  region          = var.region
  cidr_block      = "10.0.0.0/16"
  web_subnet_cidr = "10.0.1.0/24"
  db_subnet_cidr  = "10.0.2.0/24"
}

module "database" {
  source = "./modules/database"

  vpc_id    = module.network.vpc_id
  subnet_id = module.network.db_subnet_id
  password  = var.db_password
}

module "compute" {
  source = "./modules/compute"

  vpc_id      = module.network.vpc_id
  subnet_id   = module.network.web_subnet_id
  db_endpoint = module.database.endpoint
}

output "app_load_balancer_dns" {
  value       = module.compute.load_balancer_dns
  description = "Point your domain CNAME record here."
}
```

When Terraform reads these module blocks, it sees that `module.database` references `module.network.vpc_id` and `module.network.db_subnet_id`. This creates an implicit dependency: the network module must complete before the database module can be planned. Terraform's dependency engine handles the ordering automatically, you do not write any explicit sequencing.

The final `output` block re-exports the compute module's load balancer DNS name as a root-level output. Child module outputs are not shown to the user at the end of apply unless they are re-exported from the root module this way. Only root-level outputs appear in the apply summary and in `terraform output`.

## Passing Outputs Between Root Configurations

Passing outputs between root configurations means sharing selected values across separate Terraform states. This is common when the network layer, database layer, and application layer are applied independently. Example: the database root configuration can read the network root configuration's `db_subnet_ids` output instead of hardcoding subnet IDs.

When your infrastructure is split across multiple root configurations, separate state files for the network layer, the database layer, and the application layer, you need a way to pass information from one root configuration to another without hardcoding values.

The most direct way to do this is to look up the other configuration's state using the `terraform_remote_state` data source:

```hcl
data "terraform_remote_state" "network" {
  backend = "s3"
  config = {
    bucket = "my-company-terraform-state"
    key    = "production/network/terraform.tfstate"
    region = "us-east-1"
  }
}

resource "aws_db_subnet_group" "main" {
  name       = "main-db-subnet-group"
  subnet_ids = data.terraform_remote_state.network.outputs.db_subnet_ids
}
```

`data.terraform_remote_state.network.outputs` gives you access to every output declared in the network configuration's root module. No API calls to the cloud provider are needed because Terraform reads the remote state file directly from S3.

This approach tightly couples the two configurations: the database configuration must know the exact S3 bucket and key where the network configuration stores its state. It also gives the caller access to the entire state snapshot, not only the outputs, because the caller needs permission to read the remote state object. State backend permissions therefore need to be treated as sensitive. Some teams prefer to decouple this by publishing values somewhere narrower, such as a parameter store, DNS record, or service discovery registry, or by querying the actual cloud resource with a provider data source like `data "aws_vpc" "main"` using tags. Both approaches work; the right choice depends on how tightly you want to couple the configurations and how much state access you are willing to grant.

## What to Output and What to Leave Private

Not everything a module creates needs to be an output. The goal is to expose enough for callers to do their job, without leaking internal implementation details.

The right outputs to expose are:

Resource identifiers that callers need to attach to other resources. A VPC ID, a subnet ID, a security group ID, an IAM role ARN, anything that a downstream resource or module needs to reference.

Computed information that the caller cannot predict before the apply. A load balancer's DNS name assigned by AWS. A database's connection endpoint. A generated password. An auto-assigned IP address.

Diagnostic information that operators need to verify the deployment worked correctly. The public IP of a bastion host. The URL of an application endpoint. The S3 bucket name where logs are stored.

Outputs to avoid:

Internal implementation details that no caller needs. The ARN of an internally-used IAM role. The ID of a private security group that is never referenced outside the module. The name of a CloudWatch log group that callers do not interact with.

Duplicate outputs that mirror information already available elsewhere. If the caller already has the subnet ID (they passed it in as a variable), there is no reason to output it back.

Keeping outputs minimal makes the module's interface stable. When you later refactor the module's internals, splitting a resource into two, or replacing one resource type with another, callers are unaffected as long as the outputs remain the same.

## Putting It All Together

Outputs do two jobs. For operators, they surface the key results of an infrastructure deployment, the addresses, names, and IDs that are needed to configure DNS, set up monitoring, or connect applications. For modules, they are the mechanism that passes computed values between modules so each piece of the infrastructure can reference the pieces it depends on.

The pattern is consistent: the network module declares its VPC ID and subnet IDs as outputs. The database module accepts them as inputs. The compute module accepts both network and database information as inputs. The root configuration assembles them, wiring outputs to inputs through module references like `module.network.vpc_id`. Terraform reads these references, infers the dependency order, and applies everything in the correct sequence.

Root-level outputs appear in the apply summary and are queryable with `terraform output`. Sensitive outputs are hidden from casual display but accessible when queried explicitly or consumed by other Terraform configurations.

## What's Next

You now have the full values layer: input variables bring external information in, locals compute intermediate derived values, and outputs send information back out. The next article covers expressions and functions, the full set of built-in tools for computing, transforming, and querying values inside Terraform configurations.


![Output values summary: expose useful facts, hide internals, and mark sensitive values deliberately.](/content-assets/articles/article-iac-terraform-values-outputs/outputs-summary.png)

---

**References**

- [Output Values (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/values/outputs), Complete reference for output blocks, sensitive outputs, and how outputs integrate with module chaining.
- [Command: output (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/cli/commands/output), Reference for the `terraform output` command, including `-raw` and `-json` flags.
- [Output Block Reference (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/block/output), Current reference for output arguments, including sensitive and ephemeral output behavior.
- [The terraform_remote_state Data Source (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state/remote-state-data), Reference for reading another configuration's outputs via remote state.
