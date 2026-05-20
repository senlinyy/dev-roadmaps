---
title: "Role Defaults and Vars"
description: "Use role defaults as the caller contract and role vars only for stronger internal values."
overview: "Role inputs are easiest to understand when defaults and vars have separate jobs."
tags: ["ansible", "roles", "defaults", "vars"]
order: 2
id: article-infrastructure-as-code-ansible-role-defaults-vars
---

## Table of Contents

1. [Role Inputs](#role-inputs)
2. [Defaults](#defaults)
3. [Inventory Overrides](#inventory-overrides)
4. [Role Vars](#role-vars)
5. [Required Values](#required-values)
6. [Variable Names](#variable-names)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Role Inputs

The previous article used a role to group the `orders` service work. A role becomes reusable only when its inputs are clear. If a caller cannot tell which values the role expects, the role may run but still feel unsafe to use.

The `orders_web` role might need these values:

- The public hostname for the Nginx site.
- The local port where `orders-api` listens.
- The Unix user that owns service files.
- The log directory path.
- The proxy timeout used for slow requests.

Those values should not be hidden in templates or repeated inside task files. They should be visible as role inputs. In Ansible roles, the two files people often confuse are `defaults/main.yml` and `vars/main.yml`. Both contain variables. Their job is not the same.

Defaults are weak values meant to be overridden. Role vars are stronger values that callers cannot override as easily. That difference is a design tool. Use defaults to define the role's caller contract. Use role vars only for internal constants that should rarely change.

## Defaults

Defaults live in `defaults/main.yml`. They have low precedence, which means most other variable sources can override them.

```yaml
orders_api_port: 8080
orders_server_name: orders.local
orders_log_dir: /var/log/orders
orders_user: orders
orders_proxy_timeout: 30s
```

This file does two things. It gives the role enough values to run in a simple environment, and it documents the knobs callers are expected to understand.

If a developer reads only `defaults/main.yml`, they should learn the role's basic input surface. They should not have to search every template for `{{ orders_... }}` to discover what values exist.

Defaults are also useful for local development and labs. A local inventory can accept `orders_api_port: 8080` and `orders_server_name: orders.local`. Production can override only the values that differ.

The surprise is that a default value can look like a real production value. Avoid fake secrets and misleading placeholders. A default database password such as `password` is worse than no default because someone may accidentally deploy it. For values that must be chosen deliberately, use an assertion instead of a pretend default.

## Inventory Overrides

Inventory describes hosts and environment-specific values. A staging inventory and a production inventory can use the same role with different inputs.

Production group variables might set:

```yaml
orders_server_name: orders.example.com
orders_api_port: 8081
orders_proxy_timeout: 45s
```

When the role runs on production hosts, these values replace the defaults. The role does not need a production-specific copy. The template still says `{{ orders_server_name }}`, and inventory decides what that means for the host.

This is the normal relationship:

| Location | Job |
|----------|-----|
| Role defaults | Show the role's expected inputs and safe fallback values. |
| Inventory | Supply environment-specific values for real hosts. |
| Playbook | Connect hosts to roles. |

Keeping that split makes reviews easier. A role change asks, "Did the service automation change?" An inventory change asks, "Did the environment value change?"

Extra vars passed on the command line have very high precedence. They can be useful for one-off runs, but they can also hide where a value came from. If production regularly needs a value, put it in inventory instead of relying on `-e` during manual runs.

## Role Vars

Role vars live in `vars/main.yml`. They have higher precedence than role defaults. That makes them harder for callers to override.

Use role vars for values that are internal to the role and should not normally be part of the caller contract.

```yaml
orders_systemd_unit_name: orders-api.service
orders_nginx_site_path: /etc/nginx/conf.d/orders.conf
```

These values may still be variables because several task files or templates use them. That does not mean callers should usually change them. The systemd unit name and Nginx destination path might be implementation details of the role.

The common mistake is putting normal caller knobs in `vars/main.yml`:

```yaml
orders_api_port: 8080
```

That looks harmless until production inventory tries to set `orders_api_port: 8081` and the role var wins. The role becomes frustrating because the caller did what looked reasonable and Ansible still used the role's stronger value.

As a rule, if a value answers "What should this environment use?", put it in defaults so inventory can override it. If a value answers "What internal name does this role use?", role vars may be appropriate.

## Required Values

Some values should not have defaults. A public hostname, a private token, or a database password may need to be supplied deliberately by the caller.

For those values, fail early with an assertion:

```yaml
- name: Require orders server name
  ansible.builtin.assert:
    that:
      - orders_server_name is defined
      - orders_server_name | length > 0
    fail_msg: "orders_server_name must be set for the orders_web role."
```

This task gives a clear error before the role writes a bad config file. It is better than rendering `server_name ;` into Nginx and finding the problem later during reload.

You can also combine defaults with assertions. A default can be safe for local use, while production inventory is expected to override it. If that distinction matters, make the environment rule explicit with a variable such as `orders_environment`.

Be careful with secrets in assertions and debug output. An assertion should prove that a secret exists, not print the secret. The role should also avoid showing secret-bearing files in diff output.

## Variable Names

Ansible variables share a broad namespace during a play. That makes names important. A role should prefix its variables with the role or service name so they do not collide with other roles.

For the `orders_web` role, these names are clear:

```yaml
orders_api_port: 8080
orders_server_name: orders.local
orders_log_dir: /var/log/orders
```

These names are too vague:

```yaml
api_port: 8080
server_name: orders.local
log_dir: /var/log/orders
```

The vague names might collide with another role that also has an `api_port` or `log_dir`. The collision may not show up until two roles run in the same play.

Variable names are part of the role's public interface. Once other inventories use `orders_api_port`, renaming it becomes a compatibility change. If you need to rename a variable, support the old name for a transition or make the breaking change explicit in the role documentation.

## Putting It All Together

The `orders_web` role needs a clean caller contract. Defaults show the expected inputs: port, hostname, log directory, user, and timeout. Inventory overrides those values for staging and production. Role vars hold internal names that callers should not usually change. Assertions catch required values before the role writes broken files.

The difference is mostly about who owns the value:

| Value | Best location | Reason |
|-------|---------------|--------|
| `orders_api_port` | `defaults/main.yml`, overridden by inventory | Environments may choose different ports. |
| `orders_server_name` | Required or defaulted carefully | A real hostname is an environment decision. |
| `orders_log_dir` | `defaults/main.yml` | The default is useful, but callers can change it. |
| `orders_systemd_unit_name` | `vars/main.yml` | It is an internal role detail in this design. |

The practical surprise is that stronger precedence is not always better. A reusable role should make the caller's reasonable override work. Defaults are weak on purpose.

## What's Next

The next article covers Ansible's other reuse tools. Roles package a full unit of work, but imports, includes, and collections handle smaller reuse, runtime choices, and shared content from outside the role.

---

**References**

- [Using variables](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_variables.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/ansible/latest/reference_appendices/general_precedence.html)
- [Roles](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html)
- [ansible.builtin.assert module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/assert_module.html)
