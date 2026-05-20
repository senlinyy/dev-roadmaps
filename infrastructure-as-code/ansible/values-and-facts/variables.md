---
title: "Variables"
description: "Choose clear homes for Ansible values so one playbook can work across hosts and environments."
overview: "Variables let Ansible reuse the same tasks with different host, group, role, or runtime values."
tags: ["ansible", "variables", "values"]
order: 1
id: article-infrastructure-as-code-ansible-variables
---

## Table of Contents

1. [What Variables Are](#what-variables-are)
2. [Why Values Move Out of Tasks](#why-values-move-out-of-tasks)
3. [Inventory Variables](#inventory-variables)
4. [Play Variables](#play-variables)
5. [Role Defaults](#role-defaults)
6. [Runtime Values](#runtime-values)
7. [Naming and Secrets](#naming-and-secrets)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## What Variables Are

Ansible variables are named values. A task, template, condition, or role can read the name during a run and use the value for the current host.

For the orders service, the Nginx config may need an API port and a public server name:

```nginx
proxy_pass http://127.0.0.1:{{ orders_api_port }};
server_name {{ orders_server_name }};
```

The template stays the same. Staging can set `orders_server_name` to `staging-orders.example.com`, and production can set it to `orders.example.com`. The task that renders the template does not need to be copied for each environment.

A variable is simple by itself. The harder part is choosing where the value should live. Ansible can load values from inventory, playbooks, roles, command-line extra vars, facts, registered results, and other places. Clear projects decide which kind of value belongs where.

## Why Values Move Out of Tasks

Start with a task that has everything hardcoded:

```yaml
- name: Render orders site config
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
```

That task is fine because the source and destination are part of the role's stable behavior. Now imagine the template itself contains the production domain and port directly:

```nginx
server_name orders.example.com;
proxy_pass http://127.0.0.1:8080;
```

This works for production only. Staging needs a different domain. A preview environment may need a different port. If those values stay hardcoded, teams usually copy the template or add manual edits after deployment.

Variables let the stable workflow stay stable while the environment-specific data moves to a better home:

```nginx
server_name {{ orders_server_name }};
proxy_pass http://127.0.0.1:{{ orders_api_port }};
```

This is the main reason to use variables. They separate what the playbook does from the values that change by host, group, environment, or run.

## Inventory Variables

Inventory variables describe hosts and groups. They are a good home for values that belong to an environment or a host selection.

For the orders web group, inventory might define the service name and API port:

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
```

Every host in `orders_web` receives those values. A staging inventory can use the same group name and different values:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-staging-web-01:
      vars:
        orders_api_port: 8080
        orders_server_name: staging-orders.example.com
```

Inventory variables are useful for environment values, connection users, hostnames, ports, feature flags, and host-specific exceptions. They also make review easier because environment differences are visible in inventory instead of hidden inside templates.

## Play Variables

A play can define variables under `vars`. These values belong to the play itself.

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  vars:
    orders_nginx_timeout_seconds: 30
  tasks:
    - name: Render orders site config
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
```

Use play variables when the value is part of this play's behavior and does not really belong to the inventory. A timeout that every orders web environment should share might be reasonable here.

If the value changes by environment, inventory is usually clearer. If the value is part of a reusable role contract, role defaults are usually clearer. If the value is a one-time operator override, extra vars may be clearer.

The practical surprise is that putting a value in `vars` can make it stronger than expected. A play variable can override weaker values. If you place environment data in the play, it may be harder for inventory to express staging and production differences.

## Role Defaults

Roles can define default values in `defaults/main.yml`. Defaults are intentionally easy to override.

For an orders web role, defaults might look like this:

```yaml
orders_api_port: 8080
orders_nginx_timeout_seconds: 30
orders_log_dir: /var/log/orders-api
```

Defaults give the role a readable contract. Someone opening the role can see the values the role expects without searching through every task and template.

The word "default" is important. A default should be safe, ordinary, and easy to replace. It should not contain production secrets. It should not be the only place a production-specific hostname exists. Use defaults to make the role usable and understandable, then let inventory or other callers provide environment-specific values.

Role defaults also help avoid undefined variable errors. A template that expects `orders_nginx_timeout_seconds` can render with the default value until an environment chooses to override it.

## Runtime Values

Sometimes a value belongs to one run only. An operator may need to temporarily raise a timeout while investigating a slow orders dependency:

```bash
ansible-playbook -i inventory/prod.yml orders-web.yml \
  -e orders_nginx_timeout_seconds=60
```

The `-e` option passes extra vars. Extra vars have high precedence, so they are useful for deliberate runtime overrides. They are also easy to misuse because the repository still shows the old value after the run completes.

Use runtime values for temporary, explicit choices. Prefer committed inventory or role defaults for values that should become part of the normal system definition.

For sensitive values, do not rely on shell history or plain inventory files. Use a secret manager, encrypted variable files, or another approved secret flow for the project. The exact secret system may vary by team, but the rule is simple: a variable name can be harmless while its value is sensitive.

## Naming and Secrets

Good variable names say what owns the value and what the value means. Prefixing role variables with the service or role name reduces collisions:

```yaml
orders_api_port: 8080
orders_server_name: orders.example.com
orders_nginx_timeout_seconds: 30
```

Short names like `port`, `timeout`, or `user` become confusing in a large playbook because many roles may need those ideas. A template can also read variables from several sources at once. Specific names make the value's purpose easier to review.

Avoid variable names that collide with Ansible, Python, or Jinja concepts. Names such as `lookup`, `query`, or `hostvars` are confusing because Ansible already uses those words. Keep names ordinary, lowercase, and specific.

Secrets need extra care. A variable named `orders_database_password` is easy to understand, but the value should not be committed in plain text. If a task must print a structure that might contain secrets, mark the task with `no_log: true` or avoid printing the value at all.

## Putting It All Together

For the orders service, variables let one playbook serve more than one environment:

- Role defaults describe ordinary values the role can use.
- Inventory variables describe staging and production differences.
- Play variables hold values that belong to a specific play.
- Runtime extra vars handle deliberate one-run overrides.
- Templates and tasks read the chosen values during the run.

You do not need every variable source in every project. Give each value one clear home. When a value has a clear home, readers can predict where to change it and where to look when a run chooses the wrong value.

## What's Next

The next article explains variable precedence. Once a value can appear in more than one place, Ansible needs rules for deciding which value wins for a host during a run.

---

**References**

- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html)
- [Where to set variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html#where-to-set-variables)
- [Using encrypted variables and files](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_using_encrypted_content.html)
- [Special variables](https://docs.ansible.com/projects/ansible/latest/reference_appendices/special_variables.html)
