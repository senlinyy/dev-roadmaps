---
title: "Inventories"
description: "Understand Ansible inventory as the host map that separates names, addresses, and groups."
overview: "Inventory is the map Ansible reads before it can run work on any machine."
tags: ["ansible", "inventory", "hosts", "groups"]
order: 1
id: article-infrastructure-as-code-ansible-inventories-and-connection-targets
aliases:
  - inventories-and-connection-targets
  - infrastructure-as-code/ansible/inventories-and-connection-targets.md
---

## Table of Contents

1. [What Inventory Solves](#what-inventory-solves)
2. [The Orders Platform Fleet](#the-orders-platform-fleet)
3. [Inventory Names and Connection Addresses](#inventory-names-and-connection-addresses)
4. [Groups, Children, and Useful Slices](#groups-children-and-useful-slices)
5. [Static Inventory You Can Review](#static-inventory-you-can-review)
6. [Dynamic Inventory from Cloud Metadata](#dynamic-inventory-from-cloud-metadata)
7. [Inspecting What Ansible Loaded](#inspecting-what-ansible-loaded)
8. [Safety Checks Before a Real Run](#safety-checks-before-a-real-run)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## What Inventory Solves
<!-- section-summary: Inventory is the host map Ansible uses before it can choose targets, connect, and run tasks. -->

An **inventory** is the list of machines Ansible knows about, plus the groups and connection details that describe those machines. Before Ansible can install a package, restart a service, or render a config file, it needs a clear answer to a simple question: which managed nodes are in scope for this work?

In daily production work, inventory acts as the shared map between people and automation. Operators talk about `prod_web`, the deployment pipeline runs against `orders_workers`, and an incident note names `orders-web-02` as the first host to check. Those names only stay useful when the inventory has a careful shape.

Inventory also sets up the rest of the Ansible workflow. **Patterns** choose hosts from inventory, **limits** narrow a run, **group variables** describe shared values, and **host variables** describe one-machine exceptions. If the host map is hard to read, every later playbook command carries extra risk.

## The Orders Platform Fleet
<!-- section-summary: A small production fleet gives the inventory examples a concrete shape. -->

Let's use a small orders platform as the running example. The platform has two production web servers, one production worker, one read-only reporting host, and a matching staging environment. The names are boring on purpose because production names should help humans move quickly during a deployment or an incident.

The team wants one playbook that can configure all web servers, another that can configure workers, and a shared baseline playbook for users, time sync, log shipping, and security packages. Nobody wants to copy host lists into every playbook because copied lists drift after the first rebuild or scaling event.

The inventory gives the fleet stable automation names. The web playbook can target `prod_web`, the baseline playbook can target `prod`, and a first production run can narrow to `orders-web-01`. That shape lets people say what they mean without editing task files every time the host list changes.

## Inventory Names and Connection Addresses
<!-- section-summary: The inventory name is the stable Ansible name, while ansible_host is the address Ansible connects to. -->

An inventory host has an **inventory name**. That name is what Ansible shows in play output, what templates can read as `inventory_hostname`, and what operators usually put in runbooks. The inventory name can stay stable even when the IP address or DNS record changes.

The actual network target lives in `ansible_host`. This variable tells Ansible where to connect for that inventory name. For a rebuilt instance, the team can update `ansible_host` and keep the meaningful name `orders-web-01`.

```yaml
all:
  children:
    prod_web:
      hosts:
        orders-web-01:
          ansible_host: 10.42.10.11
        orders-web-02:
          ansible_host: 10.42.10.12
    prod_workers:
      hosts:
        orders-worker-01:
          ansible_host: orders-worker-01.internal.example.com
    prod_reporting:
      hosts:
        orders-report-01:
          ansible_host: 10.42.30.21
```

This separation matters in real operations. Logs and deployment notes can keep using `orders-web-01`, while the private IP can change after an instance replacement. The playbook output stays readable because Ansible reports the inventory name instead of asking every human to remember which IP belonged to which server yesterday.

Connection variables can appear beside the host when they describe how to reach that host. A legacy reporting server might use a different SSH port, and an older image might need a specific Python interpreter path. Keep those connection facts close to the host, then move shared values into group files when several hosts need the same setting.

```yaml
prod_reporting:
  hosts:
    orders-report-01:
      ansible_host: 10.42.30.21
      ansible_port: 2222
      ansible_python_interpreter: /usr/bin/python3
```

## Groups, Children, and Useful Slices
<!-- section-summary: Groups let the same inventory support role-based, environment-based, and rollout-based targeting. -->

A **group** is a named set of hosts. Groups let a playbook say `hosts: prod_web` instead of listing every web server by hand. A host can belong to several groups, which lets the same server be selected by role, environment, region, or operating system.

Child groups let a larger group contain smaller groups. For the orders platform, `prod` can contain `prod_web`, `prod_workers`, and `prod_reporting`. The staging environment can follow the same shape, so playbooks and deployment jobs use consistent names across environments.

```yaml
all:
  children:
    prod:
      children:
        prod_web:
          hosts:
            orders-web-01:
              ansible_host: 10.42.10.11
            orders-web-02:
              ansible_host: 10.42.10.12
        prod_workers:
          hosts:
            orders-worker-01:
              ansible_host: 10.42.20.11
        prod_reporting:
          hosts:
            orders-report-01:
              ansible_host: 10.42.30.21
    staging:
      children:
        staging_web:
          hosts:
            orders-stg-web-01:
              ansible_host: 10.52.10.11
        staging_workers:
          hosts:
            orders-stg-worker-01:
              ansible_host: 10.52.20.11
```

This structure gives the team several clean target shapes. A baseline hardening play can target `prod`, a web deploy can target `prod_web`, and a staging smoke test can target `staging_web`. The playbook describes the kind of work, while the inventory carries the current fleet shape.

It also makes production review easier. When a pull request adds `orders-web-03` under `prod_web`, reviewers can see that the new host will receive every play that targets production web servers. The host joined the automation boundary through one visible inventory change.

## Static Inventory You Can Review
<!-- section-summary: Static inventory works well when the host list is small, stable, and worth reviewing in version control. -->

A **static inventory** is written as files in the automation project. It works well for small fleets, lab environments, stable bare-metal servers, and production systems where each host addition should go through code review. YAML inventory is usually easier to maintain than INI once groups, children, and host-level variables grow.

For a small orders fleet, the reviewed file might live at `inventories/prod/hosts.yml`. The pull request that adds `orders-web-03` shows both the host name and the group it joins. Reviewers can ask whether the host should receive every `prod_web` play, whether its `ansible_host` points to the right private address, and whether it needs a temporary canary group before it joins the normal rollout group.

A practical project layout often keeps one inventory directory per environment. The `hosts.yml` file describes membership, while `group_vars` and `host_vars` hold values that the next article covers in detail.

```yaml
inventories/
  staging/
    hosts.yml
    group_vars/
    host_vars/
  prod/
    hosts.yml
    group_vars/
    host_vars/
```

This layout gives reviewers quick answers. The path says which environment changed, `hosts.yml` says which machines changed, and the variable directories say which values changed. In a small team, that clarity matters more than clever inventory generation.

Static inventory also has a simple rollback story. If a host was added to the wrong group, revert the inventory commit and inspect the graph again before launching another playbook. The inventory change itself usually leaves servers untouched; the risk comes from running automation against the wrong target set after the bad map is loaded.

## Dynamic Inventory from Cloud Metadata
<!-- section-summary: Dynamic inventory builds the host map from a source such as a cloud API, usually using tags or metadata. -->

A **dynamic inventory** is generated by a plugin or script from another system. Cloud fleets often need this because instances can be replaced by autoscaling, image refreshes, blue-green deployments, or disaster recovery work. The host map should follow the live infrastructure as the provisioning system changes it.

In AWS, the `amazon.aws.aws_ec2` inventory plugin can query EC2 and build groups from instance tags. The orders team might tag instances with `App=orders`, `Environment=prod`, and `Tier=web`, then let the plugin create groups from those tags.

```yaml
plugin: amazon.aws.aws_ec2
regions:
  - us-east-1
filters:
  tag:App: orders
  instance-state-name: running
hostnames:
  - tag:Name
compose:
  ansible_host: private_ip_address
keyed_groups:
  - key: tags.Environment
    prefix: env
  - key: tags.Tier
    prefix: tier
```

With that configuration, a host tagged `Environment=prod` and `Tier=web` can appear in groups like `env_prod` and `tier_web`. The playbook can target a stable group expression while the plugin refreshes which instances currently match the cloud metadata.

Dynamic inventory moves the review point from a host list to the plugin configuration and the resource tags. That is a real production tradeoff. If a new instance has the wrong tag, Ansible can place it in the wrong group, so teams usually protect tags through infrastructure code, cloud policy, deployment checks, or a review step in the provisioning pipeline.

The plugin setup also needs a normal dependency path. The repo can pin the collection in `requirements.yml`, the CI job can run `ansible-galaxy collection install -r requirements.yml`, and the inventory plugin file can stay in source control beside the static inventory. Cloud credentials should come from the runner or controller credential system, not from values committed next to inventory. When hosts appear or disappear quickly, the runbook should include an inventory refresh step so cached inventory does not send a playbook toward retired hosts.

## Inspecting What Ansible Loaded
<!-- section-summary: ansible-inventory shows the compiled host map after inventory files, plugins, and variable sources have loaded. -->

Ansible compiles inventory before it runs a command or playbook. The compiled view includes inventory sources, groups, child groups, host variables, group variables, and plugin output. That compiled view is the one to trust because it shows what Ansible will actually use.

For a visual group graph, run:

```bash
ansible-inventory -i inventories/prod --graph
```

For the full inventory in JSON, run:

```bash
ansible-inventory -i inventories/prod --list
```

For one host's final variables, run:

```bash
ansible-inventory -i inventories/prod --host orders-web-01
```

These commands are the first verification step after changing inventory. If `orders-web-03` should be in `prod_web`, the graph should show it there. If Ansible should connect to `10.42.10.13`, the host output should show that value before a playbook tries to use it.

The compiled view also helps with common failures. An empty graph usually means the wrong inventory path was selected or a plugin failed to parse. A host in the wrong group usually points to a YAML indentation issue, a copied host entry, or a cloud tag problem. A strange SSH target often shows up as an unexpected `ansible_host`, `ansible_port`, or `ansible_user` value.

For dynamic inventory, add the plugin source to the same inspection habit:

```bash
ansible-inventory -i inventories/prod/aws_ec2.yml --list --yaml
ansible-inventory -i inventories/prod/aws_ec2.yml --graph env_prod
```

If a host is missing, fix the tag, filter, credential, or region before running the playbook. If a retired host still appears, refresh the inventory cache or check the cloud source before trusting the target list.

## Safety Checks Before a Real Run
<!-- section-summary: A safe inventory workflow proves the host map, proves connectivity, and narrows the first production run. -->

Inventory review should happen before a production playbook changes anything. Start by inspecting the graph, then inspect one representative host, then run a harmless module to confirm Ansible can reach the selected hosts.

```bash
ansible-inventory -i inventories/prod --graph prod_web
ansible-inventory -i inventories/prod --host orders-web-01
ansible -i inventories/prod prod_web -m ansible.builtin.ping
```

The `ping` module is an Ansible connectivity test. It checks that Ansible can connect, transfer and run a small module, and receive a response. It proves the inventory and basic connection path enough to move to the next check, while sudo, application health, and playbook behavior still need their own checks.

For a playbook, preview the selected hosts before running tasks. This is especially useful in pipelines because a human approver can see the target set in the job output before the deploy step starts.

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --list-hosts
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit orders-web-01 --list-hosts
```

If the target list is wrong, stop at the inventory layer. Fix the map, inspect it again, and then rerun the preview. A playbook can be perfectly written and still cause an outage when it runs against the wrong hosts.

## Putting It All Together
<!-- section-summary: Reliable inventory gives stable names, current connection targets, useful groups, and a verification path. -->

The orders platform now has a clear host map. Inventory names such as `orders-web-01` stay stable for humans, `ansible_host` stores the current connection address, and groups such as `prod_web` and `staging_web` let playbooks target useful slices without copied host lists.

The team can start with static inventory while the fleet is small. As production moves toward autoscaling or frequent instance replacement, dynamic inventory can pull from cloud metadata, provided the team treats tags and plugin filters as deployment boundaries.

The daily habit stays the same in both cases. Inspect the compiled graph, check one host's final variables, prove basic connectivity, and preview the playbook host list before changing production. Inventory is the map, so the safest automation work starts by making the map visible.

## What's Next

Once the host map is readable, values start showing up. Web ports, service users, package names, feature flags, data paths, and environment labels all need homes. The next article shows how group variables and host variables keep those values close to the machines they describe.

---

**References**

- [Ansible inventory guide](https://docs.ansible.com/projects/ansible/latest/inventory_guide/index.html)
- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Working with dynamic inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_dynamic_inventory.html)
- [Inventory plugins](https://docs.ansible.com/projects/ansible/latest/plugins/inventory.html)
- [amazon.aws.aws_ec2 inventory plugin](https://docs.ansible.com/projects/ansible/latest/collections/amazon/aws/aws_ec2_inventory.html)
- [ansible-inventory command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
- [Introduction to ad hoc commands](https://docs.ansible.com/projects/ansible/latest/command_guide/intro_adhoc.html)
