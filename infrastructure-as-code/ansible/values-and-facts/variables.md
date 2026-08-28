---
title: "Variables"
description: "Choose clear homes for Ansible values so one playbook can work across hosts and environments."
overview: "Variables let Ansible reuse the same tasks with different host, group, role, or runtime values."
tags: ["ansible", "variables", "values"]
order: 1
id: article-infrastructure-as-code-ansible-variables
---

## Table of Contents

1. [Why Do Values Change by Host and Environment?](#why-do-values-change-by-host-and-environment)
2. [Where Can Ansible Variables Come From?](#where-can-ansible-variables-come-from)
3. [How Do Tasks Consume Variables and Expressions?](#how-do-tasks-consume-variables-and-expressions)
4. [How Do Templates Turn Variables into Files?](#how-do-templates-turn-variables-into-files)
5. [How Should Production Variables Be Designed?](#how-should-production-variables-be-designed)
6. [How Do Overrides and Secrets Change the Risk?](#how-do-overrides-and-secrets-change-the-risk)
7. [How Do Discovered and Reserved Variables Differ?](#how-do-discovered-and-reserved-variables-differ)
8. [How Do You Verify the Effective Variable Context?](#how-do-you-verify-the-effective-variable-context)
9. [Check Your Answers](#check-your-answers)

An **Ansible variable** is a named value that tasks, templates, and conditions can use during a run. Variables let a playbook describe one workflow while each environment supplies the values that belong to that environment.

Think about the application platform from the previous articles. Staging uses `application-staging.example.com`, a smaller worker count, and a test payment endpoint. Production uses `application.example.com`, stricter log levels, and a private database hostname. The task list stays mostly the same: install packages, render config, validate config, restart services, and check health.

Without variables, the team would copy the playbook for staging and production. That creates drift because someone will eventually fix one copy and forget the other. With variables, the playbook keeps one set of tasks, and inventory, roles, or runtime inputs provide the values for each host.

One useful first-principles model is to treat a task like a function. A task without variables has both its operation and its input fixed in place. A task with `name: "{{ application_package }}"` still defines the operation—install a package—but the current host supplies the package name. The run therefore follows a small pipeline from value sources through resolution to task execution.

Keep these questions in view as you work through the lesson:

1. **Why Do Values Change by Host and Environment?**
2. **Where Can Ansible Variables Come From?**
3. **How Do Tasks Consume Variables and Expressions?**
4. **How Do Templates Turn Variables into Files?**
5. **How Should Production Variables Be Designed?**
6. **How Do Overrides and Secrets Change the Risk?**
7. **How Do Discovered and Reserved Variables Differ?**
8. **How Do You Verify the Effective Variable Context?**

## Why Do Values Change by Host and Environment?
<!-- section-summary: Variables let one playbook keep the same task logic while values change by environment, host, role, or release. -->

```text
reusable task + values for this host → concrete module call → result
```

A variable is the binding between a name and a value. YAML lets that value be a string, number, boolean, list, or dictionary:

```yaml
application_name: application-api
application_port: 443
application_tls_enabled: true
application_packages:
  - nginx
  - application-api
application_database:
  host: application-db.prod.internal
  port: 5432
```

The important question is not merely “What is `application_port`?” It is “What value does `application_port` have for this host at this point in the run?” Ansible resolves a separate context for each host. Two production hosts may inherit port `443`, while a staging host inherits `8443`, even though all three execute the same task and template.

Within inventory, this supports a general-rule-plus-exception design. A broad `all` group can define company-wide values, a `web` group can define application values, an environment group can define production policy, and one host can define a genuine exception. Ansible effectively flattens those inherited values into the host context before it executes the task.

## Where Can Ansible Variables Come From?
<!-- section-summary: Variables can come from inventory, roles, plays, files, facts, registered results, and extra variables. -->

Variables have several homes. The right home depends on who owns the value and how often it changes. Inventory usually owns environment and host values. Roles usually own defaults and reusable service behavior. A play can define values that belong only to that play. Runtime inputs can carry release-specific values, such as the application version being deployed.

For the application platform, production inventory might include group variables for every web host. These values describe the production environment rather than the role's reusable defaults.

```yaml
application_api_public_name: application.example.com
application_api_listen_port: 8080
application_api_log_level: warn
application_api_database_host: application-db.prod.internal
application_api_health_path: /health
```

A role default can provide values that are safe for most callers. These defaults make the role runnable while still allowing inventory to override real environment details.

```yaml
application_api_service_name: application-api
application_api_config_dir: /etc/application-api
application_api_user: application
application_api_group: application
```

A release pipeline can provide a value that belongs to one deployment event. The value belongs to the run record because every release can choose a different version.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml -e application_api_release=2026.06.13
```

Facts and registered results also become variables during a run. Facts come from host discovery, such as operating system family or network interfaces. Registered results come from task output, such as a health check response. Those are live observations, so later articles will treat them carefully.

Inventory files do not have to carry every value inline. A common layout gives group and host data their own files:

```text
project/
├── inventory/hosts.yml
├── group_vars/
│   ├── all.yml
│   ├── web.yml
│   ├── production.yml
│   └── staging.yml
├── host_vars/
│   └── application-web-03.yml
└── site.yml
```

This layout makes ownership visible. `group_vars/all.yml` holds values shared everywhere, `group_vars/web.yml` holds policy for web hosts, and `host_vars/application-web-03.yml` holds an exception that applies only to that inventory host. It separates the automation logic from the data that selects how the logic behaves.

Roles add two sources with different intent. `roles/application_api/defaults/main.yml` is the role's public, overridable input surface. A value such as `application_api_workers: 4` means “use four unless the caller supplies something more specific.” `roles/application_api/vars/main.yml` has much stronger precedence and is therefore better for implementation details that ordinary callers should not normally replace. A customizable knob belongs in `defaults/` more often than `vars/`.

A play can also define `vars:` for data genuinely scoped to that orchestration. This is convenient, but production database names, domains, and environment settings usually belong with inventory. Otherwise the playbook starts mixing “what work should happen?” with “which environment-specific values should it use?”

## How Do Tasks Consume Variables and Expressions?
<!-- section-summary: Tasks use Jinja2 expression syntax to place variable values into module arguments. -->

Ansible uses Jinja2 expression syntax for variables. In a task argument, `{{ application_api_config_dir }}` means "use the value of this variable for the current host." If the whole YAML value is a Jinja2 expression, quote it so YAML parses the line safely.

```yaml
- name: Create application API config directory
  ansible.builtin.file:
    path: "{{ application_api_config_dir }}"
    state: directory
    owner: root
    group: "{{ application_api_group }}"
    mode: "0750"

- name: Install selected application API release
  ansible.builtin.package:
    name: "application-api-{{ application_api_release }}"
    state: present
```

The same task can now run for staging and production. On staging, `application_api_config_dir` might still be `/etc/application-api`, while `application_api_release` points to a test build. On production, the release value comes from the approved deployment job.

Variables can hold strings, numbers, booleans, lists, and dictionaries. A list is useful for packages or allowed origins. A dictionary is useful for structured application settings. The module receives the final value after Ansible resolves variables for the current host.

```yaml
application_api_extra_packages:
  - nginx
  - application-api

application_api_feature_flags:
  capture_tax: true
  async_receipts: true
```

Specific task variables describe meaning. `application_api_listen_port` tells the reader why the number exists. A name like `port` can collide with other roles and makes debug output harder to understand.

Jinja expressions can derive values rather than merely insert them. A path may combine a directory and filename, a filter can normalize text, and dictionary fields can be selected directly:

```yaml
application_api_config_path: "{{ application_api_config_dir }}/config.yml"
application_api_service_label: "{{ application_api_service_name | upper }}"
application_api_database_port: "{{ application_api_database.port }}"
```

Conditions consume variables too. A `when:` line is already an expression context, so it does not wrap the comparison in `{{ }}`:

```yaml
- name: Start production monitoring
  ansible.builtin.service:
    name: monitoring-agent
    state: started
  when: application_environment == "production"
```

Here the variable controls whether work happens; it is not just text substitution. This is why variables are better thought of as structured input data than as simple macros.

## How Do Templates Turn Variables into Files?
<!-- section-summary: Templates turn variables into host-specific files while the source template stays in the repository. -->

A **template** is a source file processed by Jinja2 before Ansible writes it to a managed host. Templates are one of the most common places where variables become visible. The source template stays in Git, and each host receives a rendered file with its own values.


![Variable Use Flow](/content-assets/articles/article-infrastructure-as-code-ansible-variables/variable-use-flow.png)

*The use flow follows one value from name, to task argument, to rendered template, to service config, to verification.*

Here is a small application API config template. Notice how the file structure is stable while the values come from variables.

```yaml
service:
  name: application-api
  listen_port: {{ application_api_listen_port }}
  log_level: {{ application_api_log_level }}

database:
  host: {{ application_api_database_host }}

health:
  path: {{ application_api_health_path }}
```

The playbook renders that template to the host. The module writes the final file only when the rendered content differs from the remote file.

```yaml
- name: Render application API config
  ansible.builtin.template:
    src: application-api.yml.j2
    dest: "{{ application_api_config_dir }}/config.yml"
    owner: root
    group: "{{ application_api_group }}"
    mode: "0640"
    backup: true
  notify: Restart application API
```

If the rendered content matches the existing remote file, the task reports `ok`. If a variable changes and the rendered content differs, the task reports `changed` and notifies the restart handler. That is how variables connect input changes to operational output.

Templates should avoid unstable values unless the file really needs them. A timestamp inside a config template will make the file change on every run. A stable release value, hostname, port, or feature flag gives the team a clear reason for a change.

Templates can express structure as well as individual substitutions. A condition can include TLS lines only when TLS is enabled, and a loop can render every upstream server:

```jinja2
{% if application_api_tls_enabled %}
tls_certificate={{ application_api_tls_certificate }}
tls_private_key={{ application_api_tls_private_key }}
{% endif %}

{% for upstream in application_api_upstreams %}
upstream={{ upstream }}
{% endfor %}
```

Given three upstream addresses, the loop produces three concrete lines. The useful mental model is therefore `template structure + host variables = desired file contents`. Production and staging reuse the same template but render different files because their host contexts differ.

## How Should Production Variables Be Designed?
<!-- section-summary: Production variables work best when each value has one clear owner, a readable name, and a predictable type. -->

Production variable design is mostly about ownership. A value should live where the team expects to review it. Environment hostnames and database addresses usually belong in inventory. Default service paths belong in a role default. A one-time release version can come from the deployment job. Secrets belong in a secret system rather than plain inventory.

Role defaults make a role easy to use. They should be weak, friendly starting values. Inventory can override them for real environments. For example, the role can default to `application_api_log_level: info`, while production inventory sets `application_api_log_level: warn`.

Use role-specific prefixes for role variables. `application_api_log_level`, `application_api_public_name`, and `application_api_health_path` are easy to search and unlikely to collide with another role. Running several roles in the same play makes generic names such as `name`, `user`, `port`, and `enabled` confusing.

Types deserve attention too. A port should behave like a number when compared and like a string when inserted into a file. A boolean should be a real YAML boolean such as `true` or `false`, because quoted values such as `"false"` can behave differently in conditions. A list should stay a list so loops and templates can use it directly.

```yaml
application_api_listen_port: 8080
application_api_enable_receipts: true
application_api_allowed_origins:
  - https://application.example.com
  - https://admin.application.example.com
```

When a role needs required values, make that expectation visible. Teams often add an early assertion task or a documented variable table in the role README. In article form, the key idea is the same: the playbook should fail early when a required value is missing, instead of writing a broken config later.

```yaml
- name: Check required application API variables
  ansible.builtin.assert:
    that:
      - application_api_public_name is defined
      - application_api_listen_port is defined
      - application_api_listen_port | int > 0
    fail_msg: "application_api_public_name and a valid application_api_listen_port are required before rendering config"
```

That assertion gives the operator a clear error near the start of the run. Without it, the first visible failure might be a broken template, a failed service restart, or a health check that points at the app after the real problem happened in variable setup.

Prefer names that describe policy, not implementation accidents. `application_api_worker_count: 16` explains why the number exists; `magic_number: 16` does not. Variables form the input interface of reusable automation, so their names should make the role readable without forcing the operator to trace every template.

Related values can be structured when the relationship helps readers and templates:

```yaml
application_api_database:
  host: application-db.prod.internal
  port: 5432
  name: application
  ssl: true
```

That structure allows `application_api_database.host` and `application_api_database.port`, while showing that the four fields describe one database connection. Deep nesting is not automatically better, however. Keep the shape easy to override and review.

## How Do Overrides and Secrets Change the Risk?
<!-- section-summary: Extra variables are useful for release inputs, while secrets and verification need deliberate handling. -->

Extra variables from `-e` or `--extra-vars` are powerful because they can override many other values. That makes them useful for release-specific inputs such as `application_api_release`, a temporary maintenance flag, or a one-time rollback value.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml -e @release-vars.yml
```

A small release variable file is easier to audit than a long inline command. It also keeps related release inputs together.

```yaml
application_api_release: "2026.06.13"
application_api_deploy_reason: "June maintenance release"
```

Stable environment settings should usually move back into inventory or role configuration. If production only works because every operator remembers to pass `-e application_api_database_host=...`, part of production lives outside repository review. A future manual run can miss the override and render the wrong config.

Secrets need a separate habit. Database passwords, API tokens, and private keys should come from Ansible Vault, a controller credential, or an approved secret manager. Debug tasks, verbose logs, and diff output can print values, so secret-handling tasks should avoid unnecessary output and use `no_log: true` when needed.

Verification starts before the playbook changes a host. `ansible-inventory --host` shows the compiled inventory variables for one host, which helps confirm that inventory supplied the expected value.

```bash
ansible-inventory -i inventories/prod/hosts.yml --host application-web-01.example.com
```

A canary check with check and diff mode shows how variables will affect rendered files. The team can inspect the preview before widening the run.

```bash
ansible-playbook -i inventories/prod/hosts.yml site.yml --limit application-web-01.example.com --check --diff
```

After the real canary run, verify one rendered non-secret value on the host. This catches cases where the inventory value looked correct but the template used a different variable name.

```bash
ansible -i inventories/prod/hosts.yml application-web-01.example.com \
  -m ansible.builtin.command \
  -a "grep '^listen_port:' /etc/application-api/config.yml" \
  --become
```

For temporary debugging, a tagged debug task can show a non-secret value during a controlled run. The tag keeps this output out of normal deploys.

```yaml
- name: Show selected application API release
  ansible.builtin.debug:
    var: application_api_release
  tags:
    - debug-values
```

The operator can call that tag during troubleshooting and leave it out during normal deploys. This keeps value inspection available without turning every run into a log of configuration data.

The full precedence system contains many levels, but its purpose is simple: resolve conflicts when the same name comes from multiple sources. A role default of `8080`, production inventory value of `443`, and extra variable of `9443` cannot all reach the module. In that example, the explicit extra variable wins. You do not need to memorize every rung before using variables, but you should make overriding intentional and keep each kind of value in a predictable home.

Extra variables also have a typing trap. The simple `key=value` form supplies string values. JSON or a YAML/JSON file is safer when an exact boolean, number, list, or dictionary type matters:

```bash
ansible-playbook site.yml -e '{"application_api_workers":16,"application_api_tls_enabled":true}'
```

Variables and playbook keywords are separate precedence categories. For example, `remote_user: deploy` is a play keyword, while `ansible_user: admin` is a connection variable. The inventory variable can override the play keyword and ordinary command-line connection choices. If Ansible connects as an unexpected user, inspect connection variables as well as the `-u` option.

Vault encrypts stored secret data, but a run must decrypt that data before a module, API call, or template can use it. Vault therefore protects a secret at rest; `no_log: true` protects sensitive task details from ordinary output. Neither makes careless debugging safe. Printing all of `hostvars[inventory_hostname]` can expose credentials even when the source file was encrypted.

## How Do Discovered and Reserved Variables Differ?
<!-- section-summary: Facts, registered results, set_fact values, and magic variables describe runtime state rather than ordinary desired configuration. -->

Not every variable is configuration that an operator authored. **Facts** are observations Ansible gathers from a managed host, such as its operating-system family, architecture, interfaces, addresses, memory, and processor count. Inventory states what the team says about a host; a fact records what Ansible discovered from it.

```yaml
- name: Install a Debian-family package
  ansible.builtin.apt:
    name: application-api
    state: present
  when: ansible_facts['os_family'] == 'Debian'
```

A **registered variable** captures one task's result for later tasks in the same run. It can include `rc`, `stdout`, `stderr`, `changed`, and `failed` fields. It is runtime evidence, not automatically persistent configuration:

```yaml
- name: Read installed application version
  ansible.builtin.command:
    cmd: application-api --version
  register: application_version_result
  changed_when: false

- name: Show the installed version
  ansible.builtin.debug:
    var: application_version_result.stdout
```

`set_fact` creates a host value during execution, often by deriving it from discovered state. It is useful when a runtime decision genuinely depends on that state, such as choosing a worker count from the processor count. A fixed application port is still clearer as inventory or role configuration than as a task that manufactures configuration while running.

**Magic variables** describe Ansible's own inventory and execution context. `inventory_hostname` identifies the current inventory host, `groups` exposes inventory groups, `group_names` lists the current host's memberships, and `hostvars` provides access to the variables associated with hosts. Their names are reserved; they are not ordinary application inputs.

Keeping these categories separate makes troubleshooting easier:

```text
inventory and role data → desired policy
facts                   → observed host state
registered results      → observed task output
set_fact                → derived runtime value
magic variables         → Ansible execution context
```

## How Do You Verify the Effective Variable Context?
<!-- section-summary: Variables create a clean boundary between reusable task logic and the values each host or environment needs. -->

The application platform now has one playbook and one role shape. Inventory provides production hostnames, ports, log levels, and database addresses. Role defaults provide stable service paths and users. The deployment job provides the release version for one run. Templates combine those values into files on each host.


![Variables Summary](/content-assets/articles/article-infrastructure-as-code-ansible-variables/variables-summary.png)

*The summary turns variable design into practical habits: clear names, small inputs, secret boundaries, override review, and verification.*

This is the clean boundary that makes Ansible maintainable. The playbook says what work happens. Variables say which values apply to this host in this environment during this run. Verification commands show what Ansible resolved before the team widens a production change.

The next problem appears when the same variable name exists in more than one place. Ansible has a defined order for choosing the winner, and production teams need to understand that order before an override surprises them.

A complete project can now be read as a function over infrastructure. The role contains defaults, tasks, and a template. Production and staging group variables supply different ports, worker counts, log levels, and domains. `deploy.yml` applies the same role to the `web` hosts. Each host's effective context becomes the input, and the rendered configuration becomes the output.

Before trusting that output, inspect the processed host view with `ansible-inventory --host`, preview the canary with check and diff mode, run the canary, and inspect a non-secret rendered value. Those steps test the complete path from source files through precedence and Jinja rendering to the managed host.

The enduring question is: “For this host, during this run, what value should this reusable automation use?” Role defaults, group and host variables, play variables, facts, registered results, Vault values, and `-e` are different mechanisms for answering that one question.

Some values are created during execution. `ansible.builtin.set_fact` assigns a host-scoped value for later tasks, and a registered result records what one earlier task returned. Both differ from durable inventory intent: they depend on the current run and host path. Use them for derived runtime decisions, not as a hidden replacement for reviewed environment configuration.

## Check Your Answers

:::expand[Why Do Values Change by Host and Environment?]{kind="recap"}
Variables separate reusable task logic from host-specific data. Ansible resolves a context per host, so one task can produce different concrete work without being duplicated.
:::

:::expand[Where Can Ansible Variables Come From?]{kind="recap"}
Values can come from role defaults and vars, inventory, group and host files, plays, facts, task results, files, and runtime overrides. Give each kind of value a predictable owner.
:::

:::expand[How Do Tasks Consume Variables and Expressions?]{kind="recap"}
Tasks use Jinja expressions for module arguments, derived values, and filters. Conditions are already expression contexts and can use variables to decide whether a task runs.
:::

:::expand[How Do Templates Turn Variables into Files?]{kind="recap"}
A template combines stable file structure with the current host's variables. Conditions and loops can render whole sections, not only replace individual strings.
:::

:::expand[How Should Production Variables Be Designed?]{kind="recap"}
Use meaningful, role-prefixed names, stable types, shallow useful structures, and early assertions. Defaults should be easy to override; genuine environment policy belongs with inventory.
:::

:::expand[How Do Overrides and Secrets Change the Risk?]{kind="recap"}
Extra variables win conflicts and can hide run-specific configuration, while Vault protects stored secrets only. Use typed input formats, review overrides, and prevent secret values from reaching logs.
:::

:::expand[How Do Discovered and Reserved Variables Differ?]{kind="recap"}
Facts describe observed hosts, registered variables capture task results, `set_fact` derives runtime data, and magic variables expose Ansible's execution context.
:::

:::expand[How Do You Verify the Effective Variable Context?]{kind="recap"}
Inspect processed inventory, preview a canary, run it, and verify a non-secret rendered value. This checks the entire variable-resolution path rather than one source file in isolation.
:::

---

**References**

- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html) - Official guide to variable syntax, variable sources, registered variables, and extra variables.
- [Discovering variables: facts and magic variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_vars_facts.html) - Official guide to facts, magic variables, and inspecting available host data.
- [Templating with Jinja2](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_templating.html) - Official guide to using Jinja2 templates in Ansible playbooks.
- [ansible.builtin.template](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/template_module.html) - Official module reference for rendering templates, file ownership, modes, backups, and validation behavior.
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html) - Official precedence guide for configuration settings, command-line options, playbook keywords, variables, and direct assignment.
- [ansible-playbook](https://docs.ansible.com/projects/ansible/latest/cli/ansible-playbook.html) - Official CLI reference for `--extra-vars`, limits, check mode, diff mode, and execution options.
