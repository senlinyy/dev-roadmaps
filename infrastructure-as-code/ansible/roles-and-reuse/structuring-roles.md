---
title: "Structuring Roles"
description: "Organize playbooks into reusable directory structures using Ansible roles and clean variable boundaries."
overview: "A role is a named unit of reusable Ansible work with a conventional directory layout."
tags: ["ansible", "roles", "reuse", "defaults", "vars"]
order: 1
id: article-infrastructure-as-code-ansible-roles-and-reuse
aliases:
  - roles-and-reuse
  - infrastructure-as-code/ansible/roles-and-reuse.md
  - infrastructure-as-code/ansible/roles-and-reuse/roles.md
  - infrastructure-as-code/ansible/roles-and-reuse/role-defaults-and-vars.md
---

## Table of Contents

1. [From Playbook File to Role Boundary](#from-playbook-file-to-role-boundary)
2. [The Orders API Role](#the-orders-api-role)
3. [Role Directory Structure](#role-directory-structure)
4. [Defaults as the Role Interface](#defaults-as-the-role-interface)
5. [Validating Inputs Early](#validating-inputs-early)
6. [Tasks, Templates, Files, and Handlers](#tasks-templates-files-and-handlers)
7. [Calling the Role from Playbooks](#calling-the-role-from-playbooks)
8. [Verification, CI, and Review](#verification-ci-and-review)
9. [Rollback and Versioning](#rollback-and-versioning)
10. [Putting It All Together](#putting-it-all-together)
11. [What's Next](#whats-next)
12. [References](#references)

## From Playbook File to Role Boundary
<!-- section-summary: A role packages related Ansible work into one reusable service boundary. -->

An **Ansible role** is a conventional directory layout for reusable automation. It can hold tasks, defaults, variables, templates, static files, handlers, metadata, and argument validation. A role gives related work one home so playbooks can call it by name.

This helps when a playbook grows past a few tasks. In the previous articles, the orders platform gained directories, templates, copied files, partial edits, handlers, health checks, and rollout behavior. Keeping all of that in one long playbook works for the first version, and repeated reuse turns it into a maintenance problem when staging, production, and disaster-recovery environments need the same service setup.

A role gives the playbook a cleaner job. The playbook decides which hosts receive the automation and which environment values apply. The role owns how the service is installed, configured, restarted, and checked.

## The Orders API Role
<!-- section-summary: A concrete service role shows what belongs inside the role and what callers should provide. -->

The orders platform has a service named `orders-api`. Each web host needs the same basic setup: a Linux user, a config directory, an environment file, an application config, a systemd unit or drop-in, an Nginx site, and handlers for systemd, Nginx, and the app process.

The role should own the repeatable service mechanics. It should know where templates live, which handlers run after config changes, which package or binary should exist, and which health endpoint confirms the service is ready. The caller should provide environment-specific values such as the port, public hostname, upstream service endpoints, and feature flags.

The boundary looks like this:

| Role owns | Caller provides |
|---|---|
| Directory layout and file paths | Environment name |
| Service user and group | Port and hostname |
| Templates and static files | Upstream service URLs |
| Handlers and health checks | Feature flags and rollout group |
| Safe defaults and validation | Secret values through the approved secret path |

That split keeps the role reusable. Staging and production call the same role, while inventory decides the values that differ.

## Role Directory Structure
<!-- section-summary: Roles use known directory names so Ansible can find tasks, handlers, files, templates, and defaults. -->

Ansible roles use conventional directory names. You can create them manually, or you can scaffold a role with Ansible Galaxy tooling and then trim unused directories.


![Role Directory Map](/content-assets/articles/article-infrastructure-as-code-ansible-roles-and-reuse/role-directory-map.png)

*The role map shows the familiar role folders and how they create a boundary around reusable automation.*

```bash
ansible-galaxy role init orders_api --init-path roles
```

A production-ready orders role might look like this:

```yaml
roles/
  orders_api/
    defaults/
      main.yml
    tasks/
      main.yml
      packages.yml
      config.yml
      health.yml
    handlers/
      main.yml
    templates/
      orders-api.env.j2
      orders-api.yml.j2
      orders-api.nginx.conf.j2
      orders-api.service.j2
    files/
      platform-internal-ca.pem
    meta/
      argument_specs.yml
      main.yml
```

`tasks/main.yml` is the role's default task entry point. `handlers/main.yml` holds handlers that tasks can notify. `templates` holds Jinja2 templates used by `ansible.builtin.template`. `files` holds static files used by `ansible.builtin.copy`. `defaults/main.yml` holds low-precedence variables that callers can override.

This convention matters because Ansible knows how to find role content. A template task inside `orders_api` can use `src: orders-api.env.j2` without writing the full path. A handler defined in the role can be notified by a task in the role. That keeps the role readable and makes file moves less brittle.

## Defaults as the Role Interface
<!-- section-summary: Role defaults document the safe values that inventories and playbooks can override. -->

Role defaults are usually the best place to show the role's public interface. They have low precedence, so inventory, play variables, and extra variables can override them. A reader can open `defaults/main.yml` and see which knobs the role expects callers to use.


![Role Interface Flow](/content-assets/articles/article-infrastructure-as-code-ansible-roles-and-reuse/role-interface-flow.png)

*The interface flow shows defaults, required inputs, assertions, and playbook calls as the contract around a reusable role.*

```yaml
orders_api_service_name: orders-api
orders_api_user: orders
orders_api_group: orders
orders_api_config_dir: /etc/orders-api
orders_api_port: 8080
orders_api_health_path: /ready
orders_api_nginx_server_name: orders.internal.example.com
orders_api_enable_promo_codes: false
orders_api_region: us-east-1
```

These defaults should be safe and boring. A default port, service name, and config directory make local testing easy. A placeholder hostname makes the interface visible. Production inventory can override the hostname, region, and feature flags without editing role tasks.

Variable names should carry the role prefix, such as `orders_api_`. That lowers the chance of collisions when several roles run in one play. It also makes diffs clear because a variable name tells the reader which role owns it.

`defaults/main.yml` is the friendly public interface. Callers should feel safe overriding those values from inventory or a play. `vars/main.yml` has higher precedence and should be used sparingly for internal constants that callers normally should not change. If a production setting lives in `vars/main.yml`, the role is harder to reuse because inventory can no longer override it in the normal way.

## Validating Inputs Early
<!-- section-summary: Role argument validation and assert tasks catch missing or unsafe values near the start of a run. -->

Some role inputs need validation because a bad value can create a broken config file or restart the wrong service. Ansible supports role argument validation through `meta/argument_specs.yml`. When the role runs, Ansible inserts a validation task near the beginning and fails early if supplied values fall outside the specification.

For the orders role, argument specs can document important fields:

```yaml
argument_specs:
  main:
    short_description: Configure the orders API web service
    options:
      orders_api_port:
        type: int
        required: true
        description:
          - Port where the local orders API process listens.
      orders_api_nginx_server_name:
        type: str
        required: true
        description:
          - Hostname served by Nginx for orders traffic.
      payments_base_url:
        type: str
        required: true
        description:
          - Base URL used by orders-api when calling the payments service.
```

You can also add an `assert` task for checks that need custom logic:

```yaml
- name: Validate orders API port range
  ansible.builtin.assert:
    that:
      - orders_api_port | int > 1024
      - orders_api_port | int < 65536
    fail_msg: "orders_api_port must be an unprivileged TCP port."
```

When validation fails, the operator should see the bad input before any template or service task runs. That is the production value of argument specs and assertions: the role fails at the boundary where the caller supplied an unsafe value, rather than later when Nginx, systemd, or the application reports a less obvious error.

Early validation gives a junior operator a clear failure. The playbook fails before rendering a template, before touching systemd, and before restarting a service. That is much kinder than a broken config file appearing halfway through the run.

## Tasks, Templates, Files, and Handlers
<!-- section-summary: A role keeps the service setup and the matching service actions together. -->

Inside the role, `tasks/main.yml` can stay small by importing focused task files. This gives package setup, file rendering, and health checks their own review path.

```yaml
- name: Install orders API packages
  ansible.builtin.import_tasks: packages.yml

- name: Configure orders API files
  ansible.builtin.import_tasks: config.yml

- name: Check orders API health
  ansible.builtin.import_tasks: health.yml
```

The `config.yml` file might render the service unit and application config:

```yaml
- name: Render orders API systemd unit
  ansible.builtin.template:
    src: orders-api.service.j2
    dest: "/etc/systemd/system/{{ orders_api_service_name }}.service"
    owner: root
    group: root
    mode: "0644"
  notify:
    - Reload systemd
    - Restart orders API

- name: Render orders API config
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: "{{ orders_api_config_dir }}/orders-api.yml"
    owner: root
    group: "{{ orders_api_group }}"
    mode: "0640"
    validate: /usr/local/bin/orders-api --check-config %s
  notify: Restart orders API
```

The matching handlers live beside the role:

```yaml
- name: Reload systemd
  ansible.builtin.systemd_service:
    daemon_reload: true

- name: Restart orders API
  ansible.builtin.service:
    name: "{{ orders_api_service_name }}"
    state: restarted

- name: Reload Nginx
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

This is the payoff of role structure. A reviewer can open `roles/orders_api` and see the service files, templates, handlers, defaults, and validation in one place. The role acts as the service contract.

## Calling the Role from Playbooks
<!-- section-summary: A playbook selects hosts and passes environment-specific values into the role. -->

The simplest way to call a service role is at the play level with `roles`. This treats the role as part of the fixed play structure, and it keeps the playbook short.

```yaml
- name: Configure production orders web servers
  hosts: orders_web
  become: true
  serial: 1
  roles:
    - role: orders_api
```

Environment-specific values belong in inventory or group variables:

```yaml
orders_api_env: production
orders_api_nginx_server_name: orders.example.com
orders_api_region: us-east-1
payments_base_url: https://payments.internal.example.com
orders_api_enable_promo_codes: true
```

The role stays reusable because the tasks avoid hardcoded production values. Staging can call the same role with a staging hostname and staging payment endpoint. A temporary test environment can use the same role with a different inventory group.

Roles can also be loaded with `import_role` or `include_role` inside task lists. That gives more control over timing, conditions, and loops. The next article focuses on that static and dynamic reuse choice.

## Verification, CI, and Review
<!-- section-summary: Role changes should be checked with syntax checks, task listing, staging runs, and focused diffs. -->

Role verification starts before a host changes. A syntax check catches YAML and module-shape errors. Listing tasks helps reviewers see what the role will add to the play. Check mode and diff mode show predicted file changes where modules support them.

```bash
ansible-playbook -i inventories/staging orders-web.yml --syntax-check
ansible-playbook -i inventories/staging orders-web.yml --list-tasks
ansible-playbook -i inventories/staging orders-web.yml --limit orders-web-stg-01 --check --diff
```

After the staging run, verify the service state and config parsers:

```bash
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "/usr/local/bin/orders-api --check-config /etc/orders-api/orders-api.yml"
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "systemctl is-active orders-api"
ansible -i inventories/staging orders_web -m ansible.builtin.command -a "nginx -t"
```

Role-interface changes need one extra check. When `defaults/main.yml` or `meta/argument_specs.yml` changes, run a staging play with only the role's normal caller values and another run with a deliberately missing required value. The normal run proves existing inventories still satisfy the role. The missing-value run proves the role fails at the boundary with a clear message instead of failing later inside a template or handler.

In CI, teams often run syntax checks for every changed playbook and use Molecule or a similar role test harness for roles that deserve deeper coverage. The important point for a beginner is the workflow: validate structure, preview changes, run in staging, inspect the service, then promote the same role change to production.

For a role that is shared across teams, a lightweight CI job can also run `ansible-lint` and a Molecule scenario against a disposable container or VM image. `ansible-lint` catches common role and task quality problems, while Molecule proves the role can converge and then run again with no surprise changes. Those tools do not replace staging, but they catch many role mistakes before the first real host is involved.

## Rollback and Versioning
<!-- section-summary: Roles should move through environments as reviewed versions, with rollback handled through source control and small production batches. -->

Role rollback works best when role changes move through Git like application code. A bad template, default, or handler change should be reverted in source, then applied through the same playbook path. That way the role and the hosts return to the same desired state.

For production, combine role changes with `serial` so only a small batch of hosts receives the new role behavior at a time. If the first host fails health checks, fix or revert the role before the rest of the fleet changes.

```bash
git revert <role-change-commit>
ansible-playbook -i inventories/production orders-web.yml --limit orders-web-prod-01 --diff
ansible-playbook -i inventories/production orders-web.yml --limit orders_web
```

When roles are shared across repositories or teams, version them deliberately. A role in a collection should be pinned through collection requirements. A role copied from Galaxy should have a reviewed version bump instead of floating to whatever version is current during a production run.

## Putting It All Together
<!-- section-summary: A useful role has one purpose, clear defaults, early validation, related assets, and handlers that match its changes. -->

The orders API automation now has a reusable boundary. Defaults describe the role interface. Argument specs and asserts catch bad inputs early. Tasks manage packages, users, directories, templates, files, and health checks. Handlers reload systemd, restart the app, and reload Nginx after the right changed tasks.


![Roles Summary](/content-assets/articles/article-infrastructure-as-code-ansible-roles-and-reuse/roles-summary.png)

*The summary turns role structure into five design decisions: boundary, interface, tasks, handlers, and version.*

The playbook stays much smaller. It selects the `orders_web` hosts, sets `serial`, and calls `orders_api`. Inventory provides staging or production values. Reviews stay more focused because service-specific changes land inside one role directory.

Reuse still has timing choices. Sometimes Ansible should load content before the run starts. Sometimes the current host, loop item, or runtime result should choose the content during the run. Imports, includes, and collections cover that next layer.

## What's Next

The next article covers dynamic and static reuse. Roles organize service content, while imports, includes, and collections decide how Ansible loads that content and how teams share it across projects.

---

**References**

- [Roles](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse_roles.html) - Official playbook guide for role directory structure, role usage, dependencies, and argument validation.
- [Reusing Ansible artifacts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_reuse.html) - Official guide for deciding when to split playbooks into reusable files and roles.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module documentation for role templates that render files on managed hosts.
- [ansible.builtin.assert](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/assert_module.html) - Official module documentation for validating custom conditions in tasks.
- [Ansible Galaxy user guide](https://docs.ansible.com/projects/ansible/latest/galaxy/user_guide.html) - Official guide for installing and managing shared roles and collections.
