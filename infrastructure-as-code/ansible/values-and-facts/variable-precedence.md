---
title: "Variable Precedence"
description: "Understand why Ansible chooses one variable value when the same name appears in multiple places."
overview: "Variable precedence is Ansible's conflict rule for values."
tags: ["ansible", "variables", "precedence"]
order: 2
id: article-infrastructure-as-code-ansible-variables-facts-precedence
aliases:
  - variables-facts-precedence
  - infrastructure-as-code/ansible/variables-facts-precedence.md
---

## Table of Contents

1. [Why Precedence Exists](#why-precedence-exists)
2. [A Safe First Model](#a-safe-first-model)
3. [The Orders Timeout Example](#the-orders-timeout-example)
4. [Specificity in Inventory](#specificity-in-inventory)
5. [Extra Vars](#extra-vars)
6. [Seeing the Chosen Value](#seeing-the-chosen-value)
7. [Common Surprises](#common-surprises)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## Why Precedence Exists

Ansible can load the same variable name from more than one place. A role default can set `orders_nginx_timeout_seconds: 30`. Production inventory can set the same value to `45`. An operator can pass `-e orders_nginx_timeout_seconds=60` for one run.

During the run, Ansible must choose one value for each host. Variable precedence is the rule set Ansible uses to choose the winning value.

This matters because the playbook may look correct while the host receives a value from somewhere else. If the orders site renders with a 60 second proxy timeout and the repository says 45, precedence is the reason to investigate.

## A Safe First Model

Ansible's full precedence list is long. You do not need to memorize it on day one. Start with this practical shape:

```text
role defaults
  weak starting values

inventory values
  environment and host values

play and task values
  values close to a specific run path

extra vars
  strong runtime override
```

This model is a useful first map rather than the full precedence table. Role defaults are easy to override. Inventory usually describes the environment. Play and task values are closer to the work being run. Extra vars are very strong and are meant to override nearly every other source.

The best way to avoid precedence surprises is still simpler than memorizing the table: define each value in one clear place whenever you can. Precedence matters most when a project lets the same name spread across many files.

## The Orders Timeout Example

Imagine the orders web role has this default:

```yaml
orders_nginx_timeout_seconds: 30
```

Production inventory sets a higher value:

```yaml
orders_nginx_timeout_seconds: 45
```

The template uses the variable:

```nginx
proxy_read_timeout {{ orders_nginx_timeout_seconds }}s;
```

When Ansible renders the template for a production host, the inventory value wins over the role default. The rendered file receives:

```nginx
proxy_read_timeout 45s;
```

That is usually what you want. The role owns the safe default. The environment owns the production difference.

Now an operator runs:

```bash
ansible-playbook -i inventory/prod.yml orders-web.yml \
  -e orders_nginx_timeout_seconds=60
```

For that run, the template receives `60`. The role default and production inventory still exist, but the extra var has higher precedence.

## Specificity in Inventory

Inventory can define values for broad groups, narrow groups, and individual hosts. More specific inventory values can override broader ones.

For example, the broad `orders_web` group can define the ordinary API port:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
        orders-web-02:
      vars:
        orders_api_port: 8080
```

If one host is a temporary canary using a different local port, that host can set a more specific value:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
        orders-web-02:
          orders_api_port: 8081
      vars:
        orders_api_port: 8080
```

In this inventory, `orders-web-01` receives `8080`, and `orders-web-02` receives `8081`.

Host-specific values are powerful because they make exceptions possible. They also make drift easy to hide. A host override should have a clear reason and a removal plan if it is temporary.

## Extra Vars

Extra vars are passed at runtime with `-e` or `--extra-vars`. They are intentionally strong.

This makes them useful for one-run choices:

```bash
ansible-playbook -i inventory/staging.yml orders-web.yml \
  -e orders_server_name=preview-orders.example.com
```

The surprise is persistence. Extra vars do not edit inventory, role defaults, or playbooks. They affect the current run. If an operator fixes a production issue by passing an extra var and never commits the intended value, the next ordinary run can go back to the repository value.

Use extra vars when the temporary nature is clear. For normal environment configuration, prefer committed inventory. For role behavior that should have a safe default, prefer role defaults.

## Seeing the Chosen Value

When learning or troubleshooting, show the value Ansible chose for the current host:

```yaml
- name: Show orders timeout
  ansible.builtin.debug:
    var: orders_nginx_timeout_seconds
```

The output is per host:

```text
ok: [orders-web-01] => {
    "orders_nginx_timeout_seconds": 45
}
ok: [orders-web-02] => {
    "orders_nginx_timeout_seconds": 60
}
```

This tells you the chosen value, not every source that contributed to it. If the value is unexpected, search for the variable name in role defaults, inventory, play vars, included var files, command-line extra vars, and any tasks that set facts.

Debug tasks are useful while learning, but they can leak sensitive values. Do not print secrets. Remove broad debug output after the issue is understood.

## Common Surprises

The first surprise is that variables can override behavior settings too. Some connection behavior can be set in configuration, command-line options, playbook keywords, or variables. Variables are often high in the general precedence order, so a host variable such as `ansible_user` can explain a connection choice that did not come from the command line.

The second surprise is that `set_fact` and registered variables are created during the run. They can influence later tasks on the same host. This is useful, but it means the value at task 20 may not be the value that existed at task 1.

The third surprise is that dictionaries are often replaced rather than deeply merged. If one source defines a dictionary and a stronger source defines the same dictionary name, the stronger value may replace the whole structure depending on configuration and context. Avoid spreading one dictionary across many precedence layers unless the team has a clear merge rule.

## Putting It All Together

For the orders service, precedence answers one question: which value does this host use right now?

- Role defaults provide weak starting values.
- Inventory usually supplies environment and host values.
- More specific host values can override broader group values.
- Play and task values can override values for a specific run path.
- Extra vars are strong runtime overrides.
- Debug can show the final chosen value for a host.

The safest project structure is still to avoid unnecessary conflicts. Give each variable a clear home, use specific names, and treat extra vars as deliberate overrides rather than quiet configuration.

## What's Next

The next article covers facts and conditionals. Variables can describe what you intend. Facts let a playbook respond to what a host reports about itself during the run.

---

**References**

- [Using variables: variable precedence](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html#variable-precedence-where-should-i-put-a-variable)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [Special variables](https://docs.ansible.com/projects/ansible/latest/reference_appendices/special_variables.html)
- [ansible.builtin.debug module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/debug_module.html)
