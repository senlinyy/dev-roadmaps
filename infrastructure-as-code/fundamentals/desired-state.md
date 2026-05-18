---
title: "Desired State"
description: "Understand how IaC tools compare the infrastructure you describe with the infrastructure that exists, and why idempotent runs matter."
overview: "Desired state is the idea that you describe the final shape, then let a tool compare reality and change only what needs changing. This article explains the shared mental model behind Terraform, OpenTofu, and Ansible."
tags: ["desired-state", "idempotency", "terraform", "ansible"]
order: 2
id: article-infrastructure-as-code-fundamentals-desired-state-and-idempotency
aliases:
  - desired-state-and-idempotency
  - infrastructure-as-code/fundamentals/desired-state-and-idempotency.md
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Desired State](#desired-state)
3. [Reality](#reality)
4. [Comparison](#comparison)
5. [Idempotency](#idempotency)
6. [Terraform Shape](#terraform-shape)
7. [Ansible Shape](#ansible-shape)
8. [Escape Hatches](#escape-hatches)
9. [Run Evidence](#run-evidence)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)

## The Problem

The orders team now agrees that infrastructure changes should begin in files. The next question is what those files should say.

A weak file says, "run these steps in this order and hope they were not already done." That sounds familiar because it is how many manual runbooks work. Create a bucket. Add a tag. Create a role. Attach a policy. Copy a config file. Restart a service.

That style breaks down when the same automation runs twice.

- A second bucket creation might fail because the bucket already exists.
- A second user creation might create a duplicate, reset a password, or fail halfway.
- A second service restart might happen even when no config changed.
- A partial failure might leave the team unsure which steps are safe to repeat.

Desired state is the answer. Instead of writing a long memory of clicks, the team writes the final shape the system should have. The tool compares that shape with reality and changes only what is missing or different.

## Desired State

Desired state means the state you want the system to have after the tool finishes. The file describes the outcome, not every low-level step required to reach it.

For the orders API, desired state might include these facts:

| Desired object | Intended shape |
| --- | --- |
| Invoice bucket | Exists with production tags and public access blocked |
| App role | Can write invoice objects, but cannot administer every bucket |
| Web host package | Nginx is installed |
| Web host service | Nginx is enabled and running |
| Config file | The generated Nginx config matches the template |

The tool's job is to move from the current shape to that desired shape. If the bucket is missing, create it. If the tags are wrong, update them. If Nginx is already installed and running, report no change. If a config file changed, update it and restart the service only when that restart is needed.

This is the key difference between a script and a desired-state tool. A script often says "do this action." A desired-state tool says "make this fact true."

## Reality

Every IaC run has to compare files with reality. Reality can come from several places.

For cloud infrastructure, the tool talks to provider APIs. It asks what resources exist, what settings they have, and how those resources relate to the objects it already manages. Terraform and OpenTofu also keep state data that maps resource addresses in your files to remote objects in the provider.

For server configuration, the tool asks the host. Ansible modules check whether a package is installed, whether a service is running, whether a file has the expected content, or whether a user exists.

Reality is messier than the file.

- Someone may have changed a resource manually in the console.
- A provider may have filled in defaults that were not visible in the file.
- A previous run may have failed after creating one resource but before creating the next.
- A resource may exist, but not yet be imported into the tool's management state.

Desired state is powerful because it gives the team a stable question to ask: what should exist, and what is different right now?

## Comparison

The comparison step turns desired state into action. The exact words differ by tool, but the common outcomes are easy to read.

| Comparison result | Typical action | What it means |
| --- | --- | --- |
| Already matches | No change | The file and reality agree. |
| Missing | Create or install | The desired object does not exist yet. |
| Different in place | Update | The object exists, but one or more settings differ. |
| Different in a replacement-only field | Replace | The old object must be destroyed and recreated to match. |
| In reality but not in files | Ignore, import, or delete | The team must decide whether the object belongs under IaC management. |

The replacement row deserves attention. Some infrastructure settings can be changed in place. Others cannot. A database name, subnet attachment, disk type, bucket name, or region may force replacement depending on the provider and resource. Desired state does not make replacement safe by itself. It only makes the proposed replacement visible.

This is why the comparison is not a button to click through. It is evidence to read.

## Idempotency

Idempotency means a safe repeated run reaches the same result without creating extra copies or making unnecessary changes.

If the desired bucket already exists with the right settings, the next run should not create a second bucket. If the desired package is already installed, the next run should not reinstall it. If the desired service is already running, the next run should report that it is okay.

Idempotency matters because infrastructure work is full of retries. Networks fail. APIs rate limit. Humans cancel jobs. CI systems rerun. A good IaC operation should make a retry safer, not scarier.

The simplest way to recognize idempotency is the quiet second run:

```text
First run:  created bucket, updated role, rendered config
Second run: no changes
```

That second line is not boring. It is evidence that the tool can inspect reality and avoid doing work that is already done.

There are limits. A task that runs a shell command may not be idempotent unless it checks the current state first. A provisioner that calls an external API may create duplicate records if it is written as "always run this command." Desired-state tools give you the model, but individual resources and tasks still need to be written with that model in mind.

## Terraform Shape

Terraform and OpenTofu usually manage cloud resources through provider APIs. The file describes resources and data sources. The state maps those resource addresses to real remote objects.

A small resource block might describe a bucket:

```hcl
resource "aws_s3_bucket" "invoice_exports" {
  bucket = "dp-orders-invoices-prod"

  tags = {
    service     = "orders-api"
    environment = "prod"
  }
}
```

When the tool runs, it does not simply send "create bucket" every time. It compares the declared resource, the state it knows about, and the provider's current view. From that comparison it can propose creating the bucket, updating tags, doing nothing, or replacing something that cannot be changed in place.

This is why state is sensitive. State is not the desired infrastructure by itself. It is the tool's map between your files and real provider objects. If the map is missing, stale, or shared incorrectly, the plan can become confusing or dangerous.

For now, keep the beginner picture: files say what should exist, provider APIs say what does exist, and state helps the tool know which real object belongs to which line of code.

## Ansible Shape

Ansible usually manages hosts. A playbook says which hosts to target and which tasks should make facts true on those hosts.

```yaml
- name: Configure orders web host
  hosts: orders_web
  become: true
  tasks:
    - name: Install nginx
      ansible.builtin.package:
        name: nginx
        state: present

    - name: Keep nginx running
      ansible.builtin.service:
        name: nginx
        state: started
        enabled: true
```

The module decides how to check reality. The package module checks package state. The service module checks service state. A file or template module checks content, owner, permissions, and path. A good module reports `changed` only when it had to modify the host.

This is why Ansible task choice matters. A purpose-built module often knows how to be idempotent. A raw shell command may not. If a playbook uses shell commands for everything, it has recreated the old runbook problem in YAML form.

Ansible also has check mode, which asks supported modules to predict changes without applying them. That is not a perfect guarantee, because not every module can predict every effect, but it reinforces the same habit: inspect what the tool thinks will change before changing important hosts.

## Escape Hatches

IaC tools provide escape hatches because real systems sometimes need them. Terraform has provisioners and external data patterns. Ansible can run shell or command tasks. CI can call custom scripts around infrastructure tools.

Escape hatches are not automatically wrong. They are risky when they bypass the comparison model.

Suppose a task says:

```yaml
- name: Create export directory
  ansible.builtin.shell: mkdir /var/orders/exports
```

That command may fail on the second run because the directory already exists. A desired-state task is clearer:

```yaml
- name: Create export directory
  ansible.builtin.file:
    path: /var/orders/exports
    state: directory
    mode: "0750"
```

The second version says the directory should exist with a specific mode. The module can check the current host and change only what is needed.

When you reach for an escape hatch, ask what state it checks before acting, what happens on retry, and what evidence it reports afterward. If those answers are weak, the automation may be hiding an imperative script inside an IaC wrapper.

## Run Evidence

The output of an IaC run teaches you how the tool understood the comparison.

Terraform and OpenTofu plans summarize proposed actions: add, change, destroy, and sometimes replace. Ansible output usually reports hosts as `ok`, `changed`, `failed`, `skipped`, or `unreachable`. The words differ, but the review habit is shared.

| Evidence | Healthy reading |
| --- | --- |
| No changes | The files and reality already match for the managed objects. |
| Create or install | Something required by the desired state is missing. |
| Update or changed | Something exists but differs from the desired state. |
| Replace or destroy | Slow down and confirm the business impact before approving. |
| Failed | The tool could not reach the desired state, so the partial result needs inspection. |

The most useful run evidence is boring when nothing should change and specific when something should. If a tiny documentation tag change wants to replace a database, the evidence is warning you. If a configuration run reports a service restart every time even when the file did not change, idempotency may be broken.

## Putting It All Together

The orders team wanted more than files. They needed a way for tools to read those files and act safely.

- Desired state lets the team describe the final shape instead of a fragile click sequence.
- Reality comes from provider APIs, tool state, and host inspection.
- Comparison explains whether the tool should create, update, replace, delete, or do nothing.
- Idempotency makes retries and routine reruns safer.
- Run evidence tells reviewers whether the tool's planned action matches the story.

Once you can read desired state, IaC stops feeling like magic. It becomes a comparison: the files say one thing, reality says another, and the tool proposes the smallest path it understands between them.

## What's Next

The next article turns that comparison into a safe team workflow. Plans, drift checks, and blast radius control help you decide whether a proposed infrastructure change should be applied.

---

**References**

- [Terraform state](https://developer.hashicorp.com/terraform/language/state)
- [Terraform plan command](https://developer.hashicorp.com/terraform/cli/commands/plan)
- [OpenTofu core workflow](https://opentofu.org/docs/intro/core-workflow/)
- [Ansible playbooks](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_intro.html)
- [Ansible check mode](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_checkmode.html)
