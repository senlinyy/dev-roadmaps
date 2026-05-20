---
title: "Groups and Host Variables"
description: "Use group and host variables to keep Ansible values near the machines they describe."
overview: "Inventory can store values as well as host names. Those values should live at the narrowest useful scope."
tags: ["ansible", "inventory", "variables"]
order: 2
id: article-infrastructure-as-code-ansible-groups-host-variables
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Variables as Host Data](#variables-as-host-data)
3. [Group Variables](#group-variables)
4. [Host Variables](#host-variables)
5. [Files Beside Inventory](#files-beside-inventory)
6. [Merged Values](#merged-values)
7. [Precedence and Secrets](#precedence-and-secrets)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

The orders playbook should stay readable. It should say that Nginx needs a server name, an upstream port, and a config file. It should not become a pile of production addresses, staging ports, SSH users, feature flags, and one-off host exceptions.

At the same time, those values have to live somewhere. The staging orders service may use `staging-orders.example.com`. Production may use `orders.example.com`. One host may need a temporary drain flag before reload. The web tier may log in as `deploy`, while a different service uses another account.

If all of those values are hardcoded into the playbook, the playbook stops being a reusable description of work. If they are scattered across command-line overrides and old notes, nobody can tell which value a host will receive.

Ansible variables let inventory carry data about hosts and groups. The useful habit is to put a value at the narrowest scope that tells the truth.

## Variables as Host Data

A variable is a named value Ansible can use while running a playbook. Templates, tasks, and conditions can read variables.

For the orders Nginx template, the file might need a server name and upstream port:

```jinja2
server_name {{ orders_server_name }};
proxy_pass http://127.0.0.1:{{ orders_api_port }};
```

The template describes how the values are used. Inventory describes which values apply to which hosts.

That split keeps the playbook general. The same template can render a staging config and a production config because the host data changes, not the template logic.

Variables can come from many places in Ansible. This article focuses on inventory variables because they are the natural place for data attached to hosts and groups.

## Group Variables

Group variables apply to every host in a group. They are a good fit for values that are true for all orders web hosts in an environment.

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
        orders-web-02:
      vars:
        orders_api_port: 8080
        orders_server_name: orders.example.com
        ansible_user: deploy
```

Both `orders-web-01` and `orders-web-02` receive these values because both hosts are members of `orders_web`.

Group variables are useful for shared values:

| Value | Why it belongs in the group |
| --- | --- |
| `orders_api_port` | All orders web hosts proxy to the same local API port. |
| `orders_server_name` | All hosts render the same public server name. |
| `ansible_user` | The group uses the same SSH login account. |
| `orders_log_dir` | The service writes logs to the same path on each host. |

The practical surprise is that a group variable is copied into every host's effective data. If one host should be different, the group value is no longer the whole story. That difference should be visible as a host variable or a more specific group.

## Host Variables

Host variables apply to one host. They are for real host differences, not for repeated shared values.

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.40.10.21
        orders-web-02:
          ansible_host: 10.40.10.22
          orders_drain_before_reload: true
      vars:
        orders_api_port: 8080
        orders_server_name: orders.example.com
        ansible_user: deploy
```

Here, both hosts share the orders port, server name, and login user. Only `orders-web-02` has `orders_drain_before_reload: true`.

That host variable tells a specific story: this one host needs special handling before Nginx reloads. The setting lives close to the host it describes.

Host variables are useful for:

- A connection address such as `ansible_host`.
- A temporary rollout flag for one machine.
- A different disk path on a host with older storage.
- A known hardware or operating-system difference.

They are a poor place for values copied into every host. If ten host files all repeat `orders_api_port: 8080`, the value will drift. One file will eventually say `8081`, and nobody will know whether that is intentional.

## Files Beside Inventory

Inline variables are fine for small examples. Real inventories become hard to read when every group and host carries many values. Ansible can load variables from `group_vars/` and `host_vars/` files beside the inventory.

One common layout is:

```text
inventory/
  prod.yml
  group_vars/
    orders_web.yml
  host_vars/
    orders-web-02.yml
```

The inventory file can stay focused on the host map:

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

The group variable file can hold shared orders web values:

```yaml
orders_api_port: 8080
orders_server_name: orders.example.com
ansible_user: deploy
```

The host variable file can hold the one-host exception:

```yaml
orders_drain_before_reload: true
```

This layout keeps the map readable while keeping data near the inventory that owns it. It also makes review easier. A change to `group_vars/orders_web.yml` is a change for every orders web host. A change to `host_vars/orders-web-02.yml` is a change for one host.

## Merged Values

Ansible merges inventory and variable files before it runs tasks. The host's final variable view is what matters.

Use `ansible-inventory --host` to inspect one host:

```bash
ansible-inventory -i inventory/prod.yml --host orders-web-02
```

Example output:

```json
{
  "ansible_host": "10.40.10.22",
  "ansible_user": "deploy",
  "orders_api_port": 8080,
  "orders_drain_before_reload": true,
  "orders_server_name": "orders.example.com"
}
```

This output shows the values Ansible has assembled for `orders-web-02`. If the Nginx template renders the wrong server name, start here. If Ansible logs in as a surprising user, start here. Guessing from the file you last edited is slower than reading the merged view.

Merged values also reveal accidental scope. If `orders_drain_before_reload` appears on both hosts, the value was probably placed at the group level or copied into too many host files.

## Precedence and Secrets

Ansible has variable precedence rules. When the same variable is defined in more than one place, one value wins. The full precedence stack is detailed, but the beginner lesson is simpler: avoid defining the same variable in multiple places unless you have a clear reason.

For example, this is hard to review:

```yaml
orders_api_port: 8080
```

in `group_vars/orders_web.yml`, and then:

```yaml
orders_api_port: 8081
```

in `host_vars/orders-web-02.yml`.

The host value may be intentional, but it must be obvious. A variable override should explain a real host difference. If it is only a forgotten experiment, the playbook will render a different config on one host and the recap may still look successful.

Secrets need another boundary. Plain inventory and variable files are often committed to source control. Server names, ports, feature flags, and non-sensitive paths usually belong there. Passwords, private keys, API tokens, and database credentials do not.

Ansible Vault is the built-in Ansible feature for encrypting sensitive variable files. Some teams use an external secret manager instead. The key point is the same: do not hide secrets in ordinary host or group variable files just because templates need them.

## Putting It All Together

Variables keep the orders playbook from becoming environment-specific clutter.

The clean model is:

- The playbook describes work.
- Templates describe how values are used.
- Group variables describe values shared by a group.
- Host variables describe real one-host differences.
- `group_vars/` and `host_vars/` keep larger inventories readable.
- `ansible-inventory --host` shows the merged truth for one host.

Put a value where it tells the most honest story. If every orders web host shares it, use the group. If one host is different, make that difference visible on the host.

## What's Next

The next article separates the inventory name, connection address, login user, and privilege user. Those are different pieces of the run, and each fails in a different way.

---

**References**

- [Organizing host and group variables](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html#organizing-host-and-group-variables)
- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [Protecting sensitive data with Ansible vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/index.html)
