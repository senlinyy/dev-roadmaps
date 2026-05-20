---
title: "Roles"
description: "Use Ansible roles to keep related tasks, files, templates, handlers, and defaults together."
overview: "A role is a named unit of reusable Ansible work."
tags: ["ansible", "roles", "reuse"]
order: 1
id: article-infrastructure-as-code-ansible-roles-and-reuse
aliases:
  - roles-and-reuse
  - infrastructure-as-code/ansible/roles-and-reuse.md
---

## Table of Contents

1. [Why Roles Exist](#why-roles-exist)
2. [Role Layout](#role-layout)
3. [Tasks, Files, Templates, and Handlers](#tasks-files-templates-and-handlers)
4. [Calling a Role](#calling-a-role)
5. [Role Boundaries](#role-boundaries)
6. [Role Dependencies](#role-dependencies)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## Why Roles Exist

A playbook can start small. Install a package, render one file, restart one service. After a few weeks, the same playbook often contains package tasks, directories, templates, handlers, variables, and static files. Then another environment needs the same service with a different hostname. Then another team wants to reuse part of it.

Roles exist for that moment. A role is a named directory that groups related Ansible work. It gives the service a home for its tasks, handlers, templates, static files, defaults, and other supporting files.

For the `orders` service, a role might manage:

- The `orders` user and log directory.
- The Nginx site that proxies traffic to the service.
- The systemd unit that starts `orders-api`.
- The environment file read by the process.
- The handlers that reload Nginx and restart `orders-api`.

The playbook still decides which hosts receive the role. Inventory still provides environment-specific values. The role holds the repeated service work so that work is not copied across playbooks.

## Role Layout

Ansible recognizes a conventional role directory layout. The directory names matter because Ansible loads files from those locations automatically when the role runs.

```text
roles/
  orders_web/
    defaults/
      main.yml
    tasks/
      main.yml
    handlers/
      main.yml
    templates/
      orders.conf.j2
      orders-api.service.j2
      orders.env.j2
    files/
      health.json
```

`tasks/main.yml` is the main task list for the role. `handlers/main.yml` contains handlers the role can notify. `defaults/main.yml` contains low-precedence default variables. `templates/` holds Jinja2 templates used by the `template` module. `files/` holds static files used by the `copy` module.

This layout makes the role searchable. If the Nginx config is wrong, start in `templates/orders.conf.j2`. If the service does not restart, inspect `handlers/main.yml`. If production needs a different port, look for the default variable and the inventory override.

A role can contain more directories than this, but the basic shape should stay boring. Another engineer should be able to open the role and predict where the important pieces live.

## Tasks, Files, Templates, and Handlers

A role task file should read like the service being assembled. It should not force the reader to jump between unrelated playbooks to understand what the role does.

```yaml
- name: Create orders log directory
  ansible.builtin.file:
    path: "{{ orders_log_dir }}"
    state: directory
    owner: "{{ orders_user }}"
    group: "{{ orders_user }}"
    mode: "0750"

- name: Copy orders health document
  ansible.builtin.copy:
    src: health.json
    dest: /var/www/orders-health/health.json
    owner: root
    group: root
    mode: "0644"

- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
    owner: root
    group: root
    mode: "0644"
    validate: "nginx -t -c %s"
  notify: Reload nginx

- name: Render orders service unit
  ansible.builtin.template:
    src: orders-api.service.j2
    dest: /etc/systemd/system/orders-api.service
    owner: root
    group: root
    mode: "0644"
  notify: Restart orders-api
```

The role keeps the task and the files it uses near each other. `src: orders.conf.j2` resolves from the role's `templates/` directory. `src: health.json` resolves from the role's `files/` directory. The task does not need long relative paths to reach outside itself.

Handlers belong with the role because they are part of the role's behavior:

```yaml
- name: Reload nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded

- name: Restart orders-api
  ansible.builtin.systemd_service:
    name: orders-api
    state: restarted
    daemon_reload: true
```

This is one of the quiet benefits of roles. A template can notify a handler that is shipped with the same role. The playbook using the role does not need to know every internal service action unless it wants to customize the role.

## Calling a Role

A playbook applies a role to hosts. The simplest form uses the `roles` list:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  roles:
    - orders_web
```

This says that hosts in the `orders_web` group should run the `orders_web` role. The role decides its internal tasks. The play decides the target hosts, privilege escalation, and other play-level behavior.

You can also pass variables at the role call site:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  roles:
    - role: orders_web
      vars:
        orders_server_name: orders.example.com
```

That can be useful for small examples, but most real environment values belong in inventory or group variables. The role call should stay easy to read. If the playbook call has many variables, it may be hiding environment configuration that should live with the inventory.

## Role Boundaries

A role should have a real boundary. `orders_web` is a clear boundary because it manages the web-facing pieces of the `orders` service. A role named `common_tasks` or `misc_config` is usually a warning sign because it groups work by convenience rather than responsibility.

Good role boundaries make reuse safer. If another environment needs the same `orders` web setup, it can call the role with different variables. If another service needs only Nginx, it should not have to import an `orders` role and disable half of it.

There is also a size tradeoff. A role with one task may be unnecessary ceremony. A role with every task for every service becomes a new kind of monolith. A useful role is big enough to hold a coherent unit of work and small enough that its inputs and outputs are understandable.

The `orders` example might become two roles over time:

| Role | Owns | Does not own |
|------|------|--------------|
| `orders_web` | Nginx site, web health file, proxy settings | Application package build |
| `orders_service` | systemd unit, environment file, log directory | Database schema |

That split is useful only if the pieces are deployed or reused separately. Do not split a role just to make the tree look tidy.

## Role Dependencies

Roles can declare dependencies in metadata. When a role depends on another role, Ansible can run the dependency before the role.

For example, `orders_web` might require a base Nginx role:

```yaml
dependencies:
  - role: nginx_base
```

This belongs in the role's metadata file. The dependency says that the base Nginx setup is part of the role's requirement, not a random playbook detail.

Use role dependencies carefully. They make sense when one role cannot work without another. They become confusing when they hide large amounts of work from the playbook reader. If applying `orders_web` silently configures users, firewall rules, monitoring, and unrelated packages through dependencies, the role is harder to trust.

For simple service automation, explicit playbook order is often clearer:

```yaml
roles:
  - nginx_base
  - orders_web
```

This tells the reader the order without making them inspect role metadata first.

## Putting It All Together

The `orders` service moved from scattered tasks into a role because the work had become a unit. The role holds the files that describe the service, the templates that vary by environment, the tasks that place them on the host, the defaults that document inputs, and the handlers that apply service changes.

Roles do not replace playbooks or inventory. They divide responsibility:

| Piece | Job |
|-------|-----|
| Inventory | Names the hosts and supplies environment values. |
| Playbook | Chooses hosts, privileges, and which roles run. |
| Role | Holds the reusable service work. |
| Defaults | Show the role's expected inputs. |
| Handlers | Apply delayed service actions when role tasks change. |

The practical surprise is that role structure is useful only when it makes ownership clearer. A role is not better because it has more directories. It is better when another engineer can answer, "What does this service automation own, and what values do I need to provide?"

## What's Next

The next article focuses on role inputs. Defaults and vars look similar because both are YAML files with variables, but they have very different jobs in a reusable role.

---

**References**

- [Roles](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html)
- [Reusing Ansible artifacts](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse.html)
- [Handlers: running operations on change](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_handlers.html)
