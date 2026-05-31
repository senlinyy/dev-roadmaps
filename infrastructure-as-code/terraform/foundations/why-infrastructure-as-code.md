---
title: "Why Infrastructure as Code?"
description: "Understand the problems that Infrastructure as Code solves and why writing configuration files beats clicking through cloud consoles."
overview: "Before learning Terraform, you need to understand the problem it solves. This article walks through the real pain of managing cloud infrastructure by hand and explains why describing your infrastructure in code is a better approach."
tags: ["iac", "devops", "declarative", "imperative"]
order: 1
id: article-iac-terraform-foundations-why-iac
---

## Table of Contents

1. [The Starting Point: Managing Servers by Hand](#the-starting-point-managing-servers-by-hand)
2. [What Click-Ops Actually Does Behind the Scenes](#what-click-ops-actually-does-behind-the-scenes)
3. [The Drift Problem](#the-drift-problem)
4. [Why Shell Scripts Are Not the Answer](#why-shell-scripts-are-not-the-answer)
5. [What Infrastructure as Code Looks Like](#what-infrastructure-as-code-looks-like)
6. [Declarative vs Imperative: Two Different Ideas](#declarative-vs-imperative-two-different-ideas)
7. [The Real Benefits You Get Day to Day](#the-real-benefits-you-get-day-to-day)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Starting Point: Managing Servers by Hand

Infrastructure as Code is the practice of treating infrastructure changes as versioned configuration that tools can plan, review, and apply repeatedly.

Most teams start in the same place: someone logs into a cloud console, clicks around for a while, and a server appears. It works. The application deploys. Customers can connect. Job done.

This approach is called click-ops, managing infrastructure by clicking through a web interface. For a single server, it is perfectly reasonable. The problems show up gradually, over weeks and months, as the system grows.

Imagine your team needs to copy that server setup to a second cloud region. You log into the console, navigate to the new region, and repeat all the same steps from memory. Forty-five minutes later, you have a second server. But is it actually identical to the first? You probably skipped one checkbox or entered a slightly different value in one field. You will not know until something breaks.

Now imagine your company asks you to maintain three environments: development, where engineers test their code changes; staging, where you do final checks before releasing; and production, where real customers connect. You need each environment to look the same, the same network settings, the same server sizes, the same security rules. Every time you make a change in production, you need to remember to make the same change in development and staging. If you forget, the environments drift apart. A bug that only appears in staging because of a missing security rule. An outage in production caused by a configuration that works fine in development. Hours of debugging to find a two-character difference in a network setting.

This is the situation Infrastructure as Code is designed to fix.

## What Click-Ops Actually Does Behind the Scenes

When you click the button in the AWS console to create a virtual machine, you might think you are doing something special, using a privileged interface that has direct access to Amazon's hardware. You are not. Your browser is sending a normal web request.

Every action you take in the AWS console sends an HTTP request to Amazon's servers. When you fill out the form to create an EC2 instance and click the orange button, your browser packages everything you filled in, the instance type, the region, the AMI, the security groups, into a structured request and sends it to an API endpoint. Amazon's systems receive that request, validate it, and tell the physical servers to create your virtual machine. The console is just a form on top of an API.

This is an important thing to understand: there is nothing special about using the console. You are using an API either way. The console just makes it easier to explore what options are available. But because the console is a form, it does not save a record of what you did. When you create a security group by clicking through ten screens, the only record of what you created is the security group itself, sitting in AWS. The steps you followed exist only in your head.

Infrastructure as code replaces the form with a text file. Instead of filling in a form, you write down the settings you want. Then a tool reads that file and makes the same API calls that the console would have made. The result in AWS is identical. But now you have a record. You can read the file next week and know exactly what you created. You can share it with a colleague. You can store it in version control.

## The Drift Problem

In engineering, drift means two things that are supposed to be the same have silently become different.

![Console changes and scripts can change infrastructure without leaving a shared desired-state record.](/content-assets/articles/article-iac-terraform-foundations-why-iac/manual-change-drift.png)

*Clicks and scripts can change infrastructure without leaving a shared desired-state record.*

Infrastructure drift is one of the most common sources of production incidents in teams that manage servers by hand. Here is how it typically happens.

A production server starts having connection timeouts. An engineer logs into the AWS console late on a Friday afternoon to investigate. She finds that the security group is missing an outbound rule. She adds it. The problem goes away. She makes a mental note to update the documentation, but it is Friday afternoon, so it does not happen.

The documentation still says the security group looks one way. The actual security group now looks a different way. The development and staging environments still have the original security group without the new rule. Three weeks later, a different engineer is debugging a connection issue in staging. He spends two hours comparing staging to production before he notices the security group difference. He adds the same rule to staging. He means to add it to development too, but gets interrupted.

Now development, staging, and production all have slightly different security group configurations. No one knows which one is correct. The documentation is wrong. The only way to know the current state of each environment is to log in and look.

Infrastructure as code reduces drift by making the text file the reviewed desired record. If you need to add a security group rule, you change the file. You run the tool that reads the file and applies the changes. The same change goes to every environment that uses that file. The file in version control shows what the infrastructure is supposed to look like, while the plan step compares that intent with reality.

If someone does make a manual change in the console, maybe in an emergency, the next time the tool runs, it will notice the difference between the file and reality and offer to correct it. The drift is detected and fixed, rather than silently accumulating.

## Why Shell Scripts Are Not the Answer

When teams realize that clicking through a console is not scalable, many try the obvious alternative: write a shell script that runs the same AWS CLI commands automatically. The script creates the VPC, the subnets, the security groups, and the servers, one command at a time.

This is progress. The script is reproducible. You can run it again and get the same results. You can store it in version control.

But shell scripts have a fundamental problem when used for infrastructure: they do not know what already exists.

When you run a shell script to create a server, it runs the create command. If you run it a second time, it tries to run the create command again. Depending on the provider, this either fails with an error (because something with that name already exists) or creates a second server alongside the first. Neither is what you wanted.

To make a shell script safe to run multiple times, you have to add checks before every command: does this security group already exist? If yes, skip the create command. If no, create it. Does the server exist with the right settings? If no, create it. If yes, does it need any updates? If yes, run the update command. These checks quickly become the majority of the code, and they are fragile, a typo in the check logic can cause a script to try to create something that already exists, or skip creating something that should have been created.

Shell scripts also fail badly in the middle. If your script runs fifty commands and fails on command thirty-two, you now have an environment that is partially set up. To fix it, you need to figure out exactly which of the fifty commands succeeded and which did not, then run just the failed ones. There is no mechanism to do this automatically.

Infrastructure as Code tools solve both of these problems. They track what they manage using a state file, so they can usually tell the difference between something new and something they already created. And if they fail in the middle of a large operation, you can run them again and they will compare the desired state in your files, the remembered state in the state file, and the current reality reported by the cloud API. That lets the next run continue from the actual situation rather than blindly replaying every create command.

## What Infrastructure as Code Looks Like

Infrastructure as Code means describing your infrastructure in a text file, then using a tool to make reality match what the file says.

![Terraform configuration can produce a reviewable plan before cloud resources change.](/content-assets/articles/article-iac-terraform-foundations-why-iac/plan-review-gate.png)

*Infrastructure as Code makes changes reviewable before they alter shared systems.*

The text file describes what you want, the end state, without specifying the steps to get there. You do not say "first create the VPC, then create the subnet, then create the server." You say "I want a VPC with this address range, a subnet inside it, and a server inside that subnet." The tool figures out the correct order of operations.

Here is a small example that describes a simple web server setup:

```hcl
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "web" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

data "aws_ami" "amazon_linux" {
  most_recent = true
  owners      = ["amazon"]

  filter {
    name   = "name"
    values = ["al2023-ami-*-x86_64"]
  }
}

resource "aws_instance" "app" {
  ami           = data.aws_ami.amazon_linux.id
  instance_type = "t3.small"
  subnet_id     = aws_subnet.web.id
}
```

This file says: create a network with the address range 10.0.0.0/16, create a subnet inside it, and create a server inside that subnet. It does not say how to do any of that. The tool reads the file, talks to AWS, and figures out what API calls to make and in what order. The AMI value comes from a data source rather than a hardcoded AMI ID because AMI IDs are regional and can be deprecated over time.

The reference `aws_vpc.main.id` on the subnet line is particularly important. It says: the `vpc_id` for this subnet should be whatever ID gets assigned to the VPC we just defined. The tool knows it has to create the VPC first to get its ID, and then use that ID when creating the subnet. The dependency is inferred automatically from the reference.

This file is readable. A new team member can look at it and understand what infrastructure it describes in a few seconds. You can store it in Git. You can review changes to it in a pull request. You can see exactly what changed, who changed it, and when.

## Declarative vs Imperative: Two Different Ideas

These two words come up often in Infrastructure as Code discussions, and they describe two fundamentally different ways of telling a computer what to do.

Imperative means telling the computer the steps to follow. "Create a VPC. Create a subnet. Create a server." You specify the actions in order. Shell scripts are imperative. Most programming languages are imperative. You tell the computer what to do, step by step.

Declarative means telling the computer the desired end state. "I want a VPC, a subnet, and a server." You describe what you want to exist, not how to create it. The tool figures out the steps.

The advantage of the declarative approach for infrastructure is that the tool can compare what you want against what currently exists, and do only the work needed to close the gap. If the VPC already exists from a previous run, the tool does not recreate it, it just moves on to the subnet. If the server already exists with the right settings, no changes are made. The declarative file describes the target, and the tool reconciles reality to match it.

This compare-and-fix cycle is why declarative tools handle failures gracefully. If something goes wrong halfway through, the file still describes the same target. Running the tool again does not start over from scratch, it checks what already exists and creates only the missing pieces.

It is also why the same file can be used for multiple environments. You run the tool in development, it creates the development infrastructure. You run it with different settings in production, it creates the production infrastructure. The file describes the shape of the infrastructure; the specific values change based on the environment.

## The Real Benefits You Get Day to Day

The pitch for Infrastructure as Code often sounds abstract. "Reproducibility." "Consistency." "Auditability." What do these actually mean for your daily work?

**You stop making changes by clicking.** Every change to the infrastructure goes through the same process: update the file, review the change, apply it. The file tells the team what the infrastructure is supposed to look like, and the plan step checks that intent against state and provider reality. You still use the console or API for investigation sometimes, but the reviewed desired state lives in code.

**New environments take minutes, not days.** Want to spin up a copy of your production environment for performance testing? Change the target and run the tool. Everything gets created in the correct order with the correct settings. No manual steps, no checklists, no forgetting things.

**Changes are reviewed before they are applied.** Before the tool makes any real changes, it tells you exactly what it is going to do: create this resource, modify this attribute, destroy that resource. You can review the plan and confirm it looks right before committing. This catches mistakes that would otherwise only show up as an outage.

**Recovering from disasters becomes more practical.** If you lose an entire cloud region, the configuration gives you a repeatable starting point for rebuilding in another region. You still need backups, replicated data, DNS failover, credentials, quotas, and provider-specific disaster recovery planning. But you do not need to remember every resource, every setting, and every dependency from scratch; the intended infrastructure shape is written down.

**The history of your infrastructure is in Git.** Who changed the firewall rule last Tuesday? The Git log knows. What did the network look like six months ago before the big migration? Check out an old commit. Why does production have a different database size than staging? Read the pull request that changed it.

## Putting It All Together

Click-ops and shell scripts both work, up to a point. They stop working reliably when the system grows large enough that no one person can hold the entire configuration in their head. They fail when environments need to stay in sync over months and years. They break under the weight of team collaboration, where multiple people make changes and drift accumulates silently.

Infrastructure as Code replaces all of that with a text file that describes what you want and a tool that makes reality match it. The file is readable, versioned, reviewable, and shareable. The tool handles the ordering, the idempotency, the failure recovery, and the drift detection.

The specific tool we will use throughout this module is Terraform, the most widely used Infrastructure as Code tool in the industry. It works with AWS, Google Cloud, Azure, and dozens of other providers. It uses a clean, readable configuration language. And it is the foundation of modern infrastructure engineering.

## What's Next

The next article introduces Terraform itself: what it is, how it is structured, and what happens when you run `terraform apply` for the first time. We will look at how Terraform communicates with cloud providers, how it keeps track of what it created, and the basic sequence of commands you will run every time you make an infrastructure change.

![A six-part summary infographic for Infrastructure as Code covering desired state, reviewable plans, shared history, drift checks, repeatable changes, and team safety.](/content-assets/articles/article-iac-terraform-foundations-why-iac/iac-summary.png)

*Use this summary as a quick checklist for why teams move infrastructure changes into code.*


---

**References**

- [What is Infrastructure as Code? (HashiCorp)](https://www.hashicorp.com/resources/what-is-infrastructure-as-code), HashiCorp's introduction to the IaC philosophy and the problems it addresses.
- [Terraform State (HashiCorp Documentation)](https://developer.hashicorp.com/terraform/language/state), Official explanation of how Terraform remembers managed infrastructure.
- [Amazon Machine Image Deprecation (AWS Documentation)](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/ami-deprecate.html), AWS guidance on AMI deprecation and why static AMI IDs can age badly.
- [aws_ami Data Source (AWS Provider Documentation)](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/data-sources/ami), Official Terraform AWS provider reference for looking up AMIs dynamically.
- [Infrastructure as Code (Martin Fowler)](https://martinfowler.com/bliki/InfrastructureAsCode.html), A foundational article by Martin Fowler explaining the principles of treating infrastructure configuration as software.
- [Terraform Up & Running, 3rd Edition (Yevgeniy Brikman)](https://www.terraformupandrunning.com), The definitive practical guide to Terraform, starting from exactly the motivation covered in this article.
