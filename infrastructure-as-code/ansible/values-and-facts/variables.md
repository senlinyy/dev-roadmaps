---
title: "Variables"
description: "Choose clear homes for Ansible values so one playbook can work across hosts and environments."
overview: "Variables let Ansible reuse the same tasks with different host, group, role, or runtime values."
tags: ["ansible", "variables", "values"]
order: 1
id: article-infrastructure-as-code-ansible-variables
---

## Table of Contents

1. [Values That Change by Context](#values-that-change-by-context)
2. [Where Variables Come From](#where-variables-come-from)
3. [Using Variables in Tasks](#using-variables-in-tasks)
4. [Using Variables in Templates](#using-variables-in-templates)
5. [Designing Variables for Production](#designing-variables-for-production)
6. [Runtime Overrides, Secrets, and Verification](#runtime-overrides-secrets-and-verification)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)
9. [References](#references)

## Values That Change by Context
<!-- section-summary: Variables let one playbook keep the same task logic while values change by environment, host, role, or release. -->

An **Ansible variable** is a named value that tasks, templates, and conditions can use during a run. Variables let a playbook describe one workflow while each environment supplies the values that belong to that environment.

Think about the orders platform from the previous articles. Staging uses `orders-staging.example.com`, a smaller worker count, and a test payment endpoint. Production uses `orders.example.com`, stricter log levels, and a private database hostname. The task list stays mostly the same: install packages, render config, validate config, restart services, and check health.

Without variables, the team would copy the playbook for staging and production. That creates drift because someone will eventually fix one copy and forget the other. With variables, the playbook keeps one set of tasks, and inventory, roles, or runtime inputs provide the values for each host.

## Where Variables Come From
<!-- section-summary: Variables can come from inventory, roles, plays, files, facts, registered results, and extra variables. -->

Variables have several homes. The right home depends on who owns the value and how often it changes. Inventory usually owns environment and host values. Roles usually own defaults and reusable service behavior. A play can define values that belong only to that play. Runtime inputs can carry release-specific values, such as the application version being deployed.

For the orders platform, production inventory might include group variables for every web host. These values describe the production environment rather than the role's reusable defaults.

```yaml
orders_api_public_name: orders.example.com
orders_api_listen_port: 8080
orders_api_log_level: warn
orders_api_database_host: orders-db.prod.internal
orders_api_health_path: /health
```

A role default can provide values that are safe for most callers. These defaults make the role runnable while still allowing inventory to override real environment details.

```yaml
orders_api_service_name: orders-api
orders_api_config_dir: /etc/orders-api
orders_api_user: orders
orders_api_group: orders
```

A release pipeline can provide a value that belongs to one deployment event. The value belongs to the run record because every release can choose a different version.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml -e orders_api_release=2026.06.13
```

Facts and registered results also become variables during a run. Facts come from host discovery, such as operating system family or network interfaces. Registered results come from task output, such as a health check response. Those are live observations, so later articles will treat them carefully.

## Using Variables in Tasks
<!-- section-summary: Tasks use Jinja2 expression syntax to place variable values into module arguments. -->

Ansible uses Jinja2 expression syntax for variables. In a task argument, `{{ orders_api_config_dir }}` means "use the value of this variable for the current host." If the whole YAML value is a Jinja2 expression, quote it so YAML parses the line safely.

```yaml
- name: Create orders API config directory
  ansible.builtin.file:
    path: "{{ orders_api_config_dir }}"
    state: directory
    owner: root
    group: "{{ orders_api_group }}"
    mode: "0750"

- name: Install selected orders API release
  ansible.builtin.package:
    name: "orders-api-{{ orders_api_release }}"
    state: present
```

The same task can now run for staging and production. On staging, `orders_api_config_dir` might still be `/etc/orders-api`, while `orders_api_release` points to a test build. On production, the release value comes from the approved deployment job.

Variables can hold strings, numbers, booleans, lists, and dictionaries. A list is useful for packages or allowed origins. A dictionary is useful for structured application settings. The module receives the final value after Ansible resolves variables for the current host.

```yaml
orders_api_extra_packages:
  - nginx
  - orders-api

orders_api_feature_flags:
  capture_tax: true
  async_receipts: true
```

Specific task variables describe meaning. `orders_api_listen_port` tells the reader why the number exists. A name like `port` can collide with other roles and makes debug output harder to understand.

## Using Variables in Templates
<!-- section-summary: Templates turn variables into host-specific files while the source template stays in the repository. -->

A **template** is a source file processed by Jinja2 before Ansible writes it to a managed host. Templates are one of the most common places where variables become visible. The source template stays in Git, and each host receives a rendered file with its own values.

Here is a small orders API config template. Notice how the file structure is stable while the values come from variables.

```yaml
service:
  name: orders-api
  listen_port: {{ orders_api_listen_port }}
  log_level: {{ orders_api_log_level }}

database:
  host: {{ orders_api_database_host }}

health:
  path: {{ orders_api_health_path }}
```

The playbook renders that template to the host. The module writes the final file only when the rendered content differs from the remote file.

```yaml
- name: Render orders API config
  ansible.builtin.template:
    src: orders-api.yml.j2
    dest: "{{ orders_api_config_dir }}/config.yml"
    owner: root
    group: "{{ orders_api_group }}"
    mode: "0640"
    backup: true
  notify: Restart orders API
```

If the rendered content matches the existing remote file, the task reports `ok`. If a variable changes and the rendered content differs, the task reports `changed` and notifies the restart handler. That is how variables connect input changes to operational output.

Templates should avoid unstable values unless the file really needs them. A timestamp inside a config template will make the file change on every run. A stable release value, hostname, port, or feature flag gives the team a clear reason for a change.

## Designing Variables for Production
<!-- section-summary: Production variables work best when each value has one clear owner, a readable name, and a predictable type. -->

Production variable design is mostly about ownership. A value should live where the team expects to review it. Environment hostnames and database addresses usually belong in inventory. Default service paths belong in a role default. A one-time release version can come from the deployment job. Secrets belong in a secret system rather than plain inventory.

Role defaults make a role easy to use. They should be weak, friendly starting values. Inventory can override them for real environments. For example, the role can default to `orders_api_log_level: info`, while production inventory sets `orders_api_log_level: warn`.

Use role-specific prefixes for role variables. `orders_api_log_level`, `orders_api_public_name`, and `orders_api_health_path` are easy to search and unlikely to collide with another role. Generic names such as `name`, `user`, `port`, and `enabled` become confusing when several roles run in the same play.

Types deserve attention too. A port should behave like a number when compared and like a string when inserted into a file. A boolean should be a real YAML boolean such as `true` or `false`, because quoted values such as `"false"` can behave differently in conditions. A list should stay a list so loops and templates can use it directly.

```yaml
orders_api_listen_port: 8080
orders_api_enable_receipts: true
orders_api_allowed_origins:
  - https://orders.example.com
  - https://admin.orders.example.com
```

When a role needs required values, make that expectation visible. Teams often add an early assertion task or a documented variable table in the role README. In article form, the key idea is the same: the playbook should fail early when a required value is missing, instead of writing a broken config later.

```yaml
- name: Check required orders API variables
  ansible.builtin.assert:
    that:
      - orders_api_public_name is defined
      - orders_api_listen_port is defined
      - orders_api_listen_port | int > 0
    fail_msg: "orders_api_public_name and a valid orders_api_listen_port are required before rendering config"
```

That assertion gives the operator a clear error near the start of the run. Without it, the first visible failure might be a broken template, a failed service restart, or a health check that points at the app after the real problem happened in variable setup.

## Runtime Overrides, Secrets, and Verification
<!-- section-summary: Extra variables are useful for release inputs, while secrets and verification need deliberate handling. -->

Extra variables from `-e` or `--extra-vars` are powerful because they can override many other values. That makes them useful for release-specific inputs such as `orders_api_release`, a temporary maintenance flag, or a one-time rollback value.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml -e @release-vars.yml
```

A small release variable file is easier to audit than a long inline command. It also keeps related release inputs together.

```yaml
orders_api_release: "2026.06.13"
orders_api_deploy_reason: "June checkout fix"
```

Stable environment settings should usually move back into inventory or role configuration. If production only works because every operator remembers to pass `-e orders_api_database_host=...`, part of production lives outside repository review. A future manual run can miss the override and render the wrong config.

Secrets need a separate habit. Database passwords, API tokens, and private keys should come from Ansible Vault, a controller credential, or an approved secret manager. Debug tasks, verbose logs, and diff output can print values, so secret-handling tasks should avoid unnecessary output and use `no_log: true` when needed.

Verification starts before the playbook changes a host. `ansible-inventory --host` shows the compiled inventory variables for one host, which helps confirm that inventory supplied the expected value.

```bash
ansible-inventory -i inventories/prod/hosts.yml --host orders-web-01.example.com
```

A canary check with check and diff mode shows how variables will affect rendered files. The team can inspect the preview before widening the run.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit orders-web-01.example.com --check --diff
```

After the real canary run, verify one rendered non-secret value on the host. This catches cases where the inventory value looked correct but the template used a different variable name.

```bash
ansible -i inventories/prod/hosts.yml orders-web-01.example.com \
  -m ansible.builtin.command \
  -a "grep '^listen_port:' /etc/orders-api/config.yml" \
  --become
```

For temporary debugging, a tagged debug task can show a non-secret value during a controlled run. The tag keeps this output out of normal deploys.

```yaml
- name: Show selected orders API release
  ansible.builtin.debug:
    var: orders_api_release
  tags:
    - debug-values
```

The operator can call that tag during troubleshooting and leave it out during normal deploys. This keeps value inspection available without turning every run into a log of configuration data.

## Putting It All Together
<!-- section-summary: Variables create a clean boundary between reusable task logic and the values each host or environment needs. -->

The orders platform now has one playbook and one role shape. Inventory provides production hostnames, ports, log levels, and database addresses. Role defaults provide stable service paths and users. The deployment job provides the release version for one run. Templates combine those values into files on each host.

This is the clean boundary that makes Ansible maintainable. The playbook says what work happens. Variables say which values apply to this host in this environment during this run. Verification commands show what Ansible resolved before the team widens a production change.

The next problem appears when the same variable name exists in more than one place. Ansible has a defined order for choosing the winner, and production teams need to understand that order before an override surprises them.

## What's Next

The next article covers variable precedence. It follows a value such as `orders_api_log_level` through role defaults, inventory, host variables, play variables, and extra variables so the winning value is easier to predict.

---

**References**

- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html) - Official guide to variable syntax, variable sources, registered variables, and extra variables.
- [Discovering variables: facts and magic variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_vars_facts.html) - Official guide to facts, magic variables, and inspecting available host data.
- [Templating with Jinja2](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_templating.html) - Official guide to using Jinja2 templates in Ansible playbooks.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module reference for rendering templates, file ownership, modes, backups, and validation behavior.
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html) - Official precedence guide for configuration settings, command-line options, playbook keywords, variables, and direct assignment.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for `--extra-vars`, limits, check mode, diff mode, and execution options.
