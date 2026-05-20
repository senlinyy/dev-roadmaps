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

1. [The Problem](#the-problem)
2. [What Inventory Is](#what-inventory-is)
3. [Names and Addresses](#names-and-addresses)
4. [Groups](#groups)
5. [Inventory Formats](#inventory-formats)
6. [Multiple Inventories](#multiple-inventories)
7. [Seeing What Ansible Loaded](#seeing-what-ansible-loaded)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

Ansible cannot safely run a playbook until it knows which machines exist. The playbook can say `hosts: orders_web`, but that name only becomes meaningful after Ansible reads inventory.

For the orders service, this matters immediately. There may be a staging web host, two production web hosts, an API host, and a database host. A playbook that updates the Nginx reverse proxy should reach the web hosts. It should not reach the database. It should not quietly use an old IP address from a machine that was replaced last week.

Inventory mistakes are dangerous because they happen before task logic matters:

- A good playbook can run on the wrong host.
- A careful `--limit` can narrow the wrong group.
- A host name in output can hide a stale connection address.
- A copied inventory can mix staging and production machines.

Inventory is the host map. It is the first safety boundary in an Ansible project.

## What Inventory Is

Ansible inventory is a list of managed nodes and groups. It can also hold variables that describe how to connect to those nodes or what values apply to them.

A small orders production inventory might look like this:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.40.10.21
        orders-web-02:
          ansible_host: 10.40.10.22
```

This file gives Ansible two hosts and one group. A playbook can target the group:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  tasks:
    - name: Check connectivity
      ansible.builtin.ping:
```

The playbook does not need to know the IP addresses. It only needs the group that describes the role of those machines.

That separation is useful because the inventory can change without rewriting every playbook. If `orders-web-02` is rebuilt with a new address, the group can stay the same. The playbook still targets `orders_web`.

## Names and Addresses

The inventory host name and the connection address are separate ideas.

```yaml
orders-web-01:
  ansible_host: 10.40.10.21
```

`orders-web-01` is the inventory name. Ansible prints it in output, uses it in host patterns, and attaches host variables to it. `10.40.10.21` is the address Ansible uses when it connects.

This split is one of the first practical surprises in Ansible. The name in the recap may be stable and friendly while the address changes behind it.

```text
changed: [orders-web-01]
ok: [orders-web-02]
```

That output is easier to read than raw IP addresses. It also means the inventory must be maintained carefully. If `orders-web-01` points to an old address, Ansible may fail to connect or, worse, connect to a machine that should no longer receive orders changes.

An inventory name can also be an alias for a long DNS name:

```yaml
orders-web-01:
  ansible_host: ip-10-40-10-21.eu-west-2.compute.internal
```

The alias gives humans a stable service name. The address gives SSH a target.

## Groups

Groups are named target sets. A group should answer a plain question: which hosts belong to this service, tier, environment, or location?

```yaml
all:
  children:
    orders:
      children:
        orders_web:
          hosts:
            orders-web-01:
            orders-web-02:
        orders_api:
          hosts:
            orders-api-01:
```

Here, `orders` means the service as a whole. `orders_web` means only the web tier. `orders_api` means only the API tier.

Groups can have parent and child relationships. A host in `orders_web` is also part of its parent group `orders`. This helps when a play should target a whole service, while another play should target only one tier.

Groups can also be about environment:

```yaml
all:
  children:
    prod:
      children:
        orders_web:
```

Be careful with group names that are too broad. A group called `web` might make sense in a tiny inventory. In a large company, it may include unrelated services. A playbook that says `hosts: web` becomes hard to review because nobody can see the service boundary from the name.

Good group names make the blast radius visible. `orders_web` is narrow. `prod` is broad. Both can be valid, but they should not be confused.

## Inventory Formats

Ansible supports several inventory sources. Beginners usually see YAML or INI.

INI is compact:

```ini
[orders_web]
orders-web-01 ansible_host=10.40.10.21
orders-web-02 ansible_host=10.40.10.22
```

YAML is more explicit when groups and values grow:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.40.10.21
        orders-web-02:
          ansible_host: 10.40.10.22
```

The format matters less than the loaded result. INI can put many details on one line, which is quick to type but easy to skim past. YAML makes structure clearer, but indentation mistakes can put a host or variable under the wrong parent.

Ansible can also use dynamic inventory, where a plugin asks another system for the host list. Cloud inventories often work this way. The mental model stays the same: Ansible still needs a host map before it can run work. The source of the map may be a file, a directory, a script, or a plugin.

## Multiple Inventories

A project often has more than one inventory. The orders service might keep separate files for staging and production:

```text
inventory/
  staging.yml
  prod.yml
```

That separation keeps the environment boundary visible at the command line:

```bash
ansible-playbook -i inventory/staging.yml playbooks/orders-web.yml
```

```bash
ansible-playbook -i inventory/prod.yml playbooks/orders-web.yml
```

Ansible can also accept multiple inventory sources at once. That is useful for some operations, but it can surprise beginners because groups and hosts from both sources become part of the loaded inventory.

For early Ansible work, keep environment inventory separate and explicit. If a command uses production, the command should show production. If a command uses staging, it should show staging. Do not make people infer the environment from their current directory or shell history.

## Seeing What Ansible Loaded

The inventory file is only the input. The loaded inventory is the truth Ansible will use. Use `ansible-inventory` to see it before running tasks.

```bash
ansible-inventory -i inventory/prod.yml --graph
```

Example output:

```text
@all:
  |--@ungrouped:
  |--@orders:
  |  |--@orders_api:
  |  |  |--orders-api-01
  |  |--@orders_web:
  |  |  |--orders-web-01
  |  |  |--orders-web-02
```

This command does not connect to the hosts. It only shows the group tree. That is exactly why it is safe to run first.

If `orders-api-01` appears under `orders_web`, stop. If a production host appears in a staging inventory, stop. If a group is empty, stop. The playbook has not had a chance to be right or wrong yet.

To inspect one host, ask for the merged host view:

```bash
ansible-inventory -i inventory/prod.yml --host orders-web-01
```

The output might include:

```json
{
  "ansible_host": "10.40.10.21",
  "ansible_user": "deploy"
}
```

This view becomes more important as variables move into `group_vars/` and `host_vars/`. If Ansible connects to the wrong address or renders the wrong value, inspect the merged host view before guessing.

## Putting It All Together

Inventory solves the first orders problem: deciding which machines Ansible is allowed to know about and how those machines are grouped.

The key ideas are:

- The inventory name is the stable Ansible label.
- `ansible_host` is the connection address.
- Groups turn individual hosts into reviewable target sets.
- YAML, INI, static files, and dynamic sources are just different ways to build the host map.
- `ansible-inventory --graph` shows the group structure before any task runs.
- `ansible-inventory --host` shows the merged values for one host.

A playbook with excellent tasks is still unsafe if the map is wrong. Read the map first.

## What's Next

The next article adds variables to the map. Groups and hosts can carry values such as ports, domains, SSH users, and per-host exceptions. The useful skill is knowing where each value belongs.

---

**References**

- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Building an inventory](https://docs.ansible.com/projects/ansible/latest/getting_started/get_started_inventory.html)
- [ansible-inventory command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
