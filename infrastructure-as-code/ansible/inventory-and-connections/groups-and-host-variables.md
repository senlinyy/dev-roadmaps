---
title: "Groups and Host Variables"
description: "Use group and host variables to keep Ansible values near the machines they describe."
overview: "Inventory can store values as well as host names. Those values should live at the narrowest useful scope."
tags: ["ansible", "inventory", "variables"]
order: 2
id: article-infrastructure-as-code-ansible-groups-host-variables
---

## Table of Contents

1. [Why Values Need a Home](#why-values-need-a-home)
2. [The Directory Shape](#the-directory-shape)
3. [Group Variables for Shared Settings](#group-variables-for-shared-settings)
4. [Host Variables for Exceptions](#host-variables-for-exceptions)
5. [How Ansible Chooses a Value](#how-ansible-chooses-a-value)
6. [Secrets and Ansible Vault](#secrets-and-ansible-vault)
7. [Verifying Values Before a Run](#verifying-values-before-a-run)
8. [Failure Reading and Rollback](#failure-reading-and-rollback)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)
11. [References](#references)

## Why Values Need a Home
<!-- section-summary: Group and host variables let the inventory describe environment values without copying playbooks. -->

Inventory starts as a host map, then real work adds values. The orders web servers need an application port, an Nginx server name, a service user, a log directory, and a package version. Staging and production need different domains, and one older production host may need a temporary data path until it is rebuilt.

**Group variables** and **host variables** give those values a clear home. A group variable applies to every host in a group, while a host variable applies to one inventory host. The playbook can stay focused on the task, and the inventory can describe the differences between environments, roles, and one-machine exceptions.

That separation is what lets one playbook configure both staging and production. The template task can render `{{ orders_app_port }}` every time, while the value comes from the right inventory files for the selected host. The playbook remains one source of behavior instead of becoming a pile of copied environment-specific versions.

## The Directory Shape
<!-- section-summary: A predictable inventory directory makes host membership, group values, and host exceptions easy to review. -->

Most teams start with a simple layout and grow into a directory per environment. Each environment directory contains a host map and two optional variable directories. `group_vars` stores values for groups, and `host_vars` stores values for individual hosts.

```yaml
inventories/
  staging/
    hosts.yml
    group_vars/
      all.yml
      staging_web.yml
      staging_workers.yml
    host_vars/
      orders-stg-web-01.yml
  prod/
    hosts.yml
    group_vars/
      all.yml
      prod_web.yml
      prod_workers.yml
    host_vars/
      orders-web-02.yml
```

This layout gives reviewers quick clues before they read the YAML. A change under `inventories/prod/group_vars/prod_web.yml` affects production web hosts. A change under `inventories/prod/host_vars/orders-web-02.yml` affects one host, so the reviewer can ask why that machine needs special treatment.

The path also helps operators during incidents. If the order web port looks wrong on `orders-web-02`, the team can check the host file first, then the web group file, then the environment-wide `all.yml`. The files line up with the questions people ask under pressure.

## Group Variables for Shared Settings
<!-- section-summary: Group variables define shared values once for every host in a role, environment, or platform slice. -->

A **group variable** applies to every host in an inventory group. Use it for values that are true for all hosts in that group: application ports, service names, package channels, log endpoints, feature flags, timezone settings, and environment labels.

For the production web group, the orders team might define the values needed by Nginx, systemd, and the application config template:

```yaml
orders_environment: production
orders_service_user: orders
orders_app_port: 9000
orders_app_root: /opt/orders
orders_config_dir: /etc/orders
orders_nginx_server_name: orders.example.com
orders_package_version: "2026.06.12"
```

Now the web role can use the same variable names for every environment. Production supplies `orders_nginx_server_name: orders.example.com`, while staging supplies `orders_nginx_server_name: staging-orders.example.com`. The tasks stay free of environment-specific branches for normal differences.

```yaml
- name: Render orders application config
  ansible.builtin.template:
    src: orders.yml.j2
    dest: "{{ orders_config_dir }}/orders.yml"
    owner: "{{ orders_service_user }}"
    group: "{{ orders_service_user }}"
    mode: "0640"
```

Group variables can also sit directly inside inventory YAML, but separate files scale better. The host map stays about membership, and the group files stay about values. That split makes reviews cleaner when the fleet grows beyond a handful of hosts.

The full shape is easier to see when the files sit next to each other:

```yaml
# inventories/prod/hosts.yml
all:
  children:
    prod_web:
      hosts:
        orders-web-01:
        orders-web-02:

# inventories/prod/group_vars/prod_web.yml
orders_app_port: 9000
orders_nginx_server_name: orders.example.com
orders_api_log_level: warn

# inventories/prod/host_vars/orders-web-02.yml
orders_api_log_level: debug
```

For this run, `orders-web-01` receives `warn`, and `orders-web-02` receives `debug`. That one-host exception should have a reason and an expiry, because host variables are easy to forget after the incident is over.

## Host Variables for Exceptions
<!-- section-summary: Host variables should make one-machine exceptions visible and temporary. -->

A **host variable** applies to one inventory host. Use it for exceptions that truly belong to one machine: a temporary data directory, a migration flag, a special SSH port, a different disk mount, or a maintenance window for a host that has unusual customer traffic.

For example, `orders-web-02` may still use an old attached disk during a storage migration. The group default says the data directory is `/var/lib/orders`, and the host file overrides only the value that differs.

```yaml
orders_data_dir: /mnt/legacy-orders-data
orders_storage_migration_ticket: INC-48291
orders_maintenance_window: sunday-0200-utc
```

The playbook can keep rendering `{{ orders_data_dir }}` without knowing which host supplied the value. Most web hosts receive the group value, and `orders-web-02` receives the host value until the migration finishes.

Host variables should be easy to explain. If five web hosts need the same value, move it to the group. If a host variable stays around after the migration ticket closes, remove it in a cleanup pull request so the inventory stops teaching future readers that the exception is normal.

## How Ansible Chooses a Value
<!-- section-summary: Variable precedence decides which copy wins when the same variable name appears in several places. -->

Ansible has **variable precedence**, which means some variable sources override others when the same name appears more than once. The full table can wait until you need it, and the practical habit starts right away: keep each important value in one narrow, explainable place.

For inventory variables, host-specific values override broader group values. A value in `host_vars/orders-web-02.yml` can override a value from `group_vars/prod_web.yml` for that one host. More explicit runtime values, such as extra variables passed with `-e`, can override many other sources, so they deserve careful handling.

Here is a common production shape:

```yaml
# inventories/prod/group_vars/all.yml
orders_environment: production
orders_log_endpoint: logs.prod.internal.example.com
```

```yaml
# inventories/prod/group_vars/prod_web.yml
orders_app_port: 9000
orders_data_dir: /var/lib/orders
```

```yaml
# inventories/prod/host_vars/orders-web-02.yml
orders_data_dir: /mnt/legacy-orders-data
```

When Ansible prepares `orders-web-02`, `orders_data_dir` becomes `/mnt/legacy-orders-data`. When it prepares `orders-web-01`, `orders_data_dir` remains `/var/lib/orders`. That is useful, and it also means hidden duplicate values can surprise people.

Specific names reduce confusion. `port` is too vague in a real project because Nginx, the app, metrics, and admin endpoints may all have ports. Names like `orders_app_port`, `nginx_listen_port`, and `node_exporter_port` tell readers which system consumes the value and make debug output easier to search.

## Secrets and Ansible Vault
<!-- section-summary: Sensitive values need an encrypted workflow, while variable names should stay searchable for reviewers. -->

Some inventory values are sensitive. Database passwords, API tokens, become passwords, private keys, and webhook secrets should use a secret workflow instead of plain YAML. In Ansible projects, **Ansible Vault** is the built-in way to encrypt files or individual variable values.

For small projects, encrypting one variable can be enough:

```bash
ansible-vault encrypt_string --name orders_database_password
```

That command prompts for the secret value and prints encrypted YAML that can be placed in a variable file. The variable name stays visible, while the value is protected.

```yaml
orders_database_password: !vault |
  $ANSIBLE_VAULT;1.1;AES256
  3639343961383762346334373862316539316632666239653533366639366536
  3137373633343238313466363138353534663332316136310a37626539386433
```

Many production teams keep sensitive values in a separate vaulted file such as `group_vars/prod_web/vault.yml`, then keep safe defaults or variable names in a readable file such as `group_vars/prod_web/main.yml`. That pattern helps reviewers see which secrets exist without exposing the secret values.

Vault password handling also needs a team decision. A developer laptop may prompt for a Vault password, while Automation Controller or another CI system should use a managed credential. The important part is that secret access is auditable and separate from normal inventory review.

In CI or Automation Platform, the Vault password should come from a protected credential, a Vault ID, or a password client script. The repository can show `orders_database_password` as a name, while the value stays encrypted or supplied at runtime. Debug tasks should print safe metadata such as whether a value is defined, not the value itself.

## Verifying Values Before a Run
<!-- section-summary: ansible-inventory and small debug plays show the final values before a role uses them. -->

The safest way to debug variables is to inspect what Ansible compiled for one host. Start with `ansible-inventory --host` because it shows the merged values for that host without running your role.

```bash
ansible-inventory -i inventories/prod --host orders-web-02
```

If the output shows `orders_data_dir` as `/mnt/legacy-orders-data`, the host override is active. If the value is missing, check the inventory path, group name, host name, file name, YAML indentation, and whether the host actually belongs to the group that owns the variable.

For a focused check, a short ad hoc command can print a non-secret variable. Keep this away from passwords and tokens because command output often lands in terminal scrollback, CI logs, and chat transcripts.

```bash
ansible -i inventories/prod orders-web-02 -m ansible.builtin.debug -a "var=orders_data_dir"
```

For playbook validation, run check mode when the modules support it. Check mode can show which templates or packages would change, and diff mode can show rendered file differences for supported modules. Treat it as a strong preview, then still use a canary before touching the whole group.

```bash
ansible-playbook -i inventories/prod deploy-orders-web.yml --limit orders-web-02 --check --diff
```

When the rollback is a value rollback, keep the target narrow. Restore the previous variable file or remove the stale host override, run `ansible-inventory --host orders-web-02`, run the playbook with `--limit orders-web-02 --check --diff`, and only then apply. That sequence proves the winning value changed before any host receives the rendered file.

## Failure Reading and Rollback
<!-- section-summary: Variable failures usually point to missing names, wrong scope, YAML mistakes, or emergency overrides. -->

Variable problems tend to leave recognizable clues. An `undefined variable` error means the selected host never received the name the task expected. A rendered config with a staging domain in production usually means the wrong inventory path or group file was loaded. A value that changes only on one host often points to `host_vars`.

YAML mistakes are also common. A host under the wrong indentation level may leave a group empty, and an unquoted value such as `yes`, `no`, or an old-style version number can be parsed differently than a human expected. Quoting application versions and strings with special characters keeps reviews and rendered templates more predictable.

Rollback starts by restoring the value source that introduced the problem. If the bad value came from `group_vars/prod_web.yml`, revert that inventory change and rerun `ansible-inventory --host` for a representative host. If the problem came from a one-host override, remove the host variable and verify that the group value returns.

Runtime overrides need extra care. Extra variables passed with `-e` are powerful, and they can hide what the repository says. If an incident run used `-e orders_package_version=2026.06.11`, write that into the deployment record and remove the override from the next normal run so the team returns to the repository value.

## Putting It All Together
<!-- section-summary: Clean variable placement lets one playbook adapt to environments while keeping exceptions and secrets visible. -->

The orders platform now has a host map and a value map. Environment-wide values live in `group_vars/all.yml`, production web values live in `group_vars/prod_web.yml`, and the temporary storage exception for `orders-web-02` lives in one host file with a ticket number beside it.

The playbook stays readable because it uses stable variable names. Templates refer to `orders_app_port`, `orders_data_dir`, and `orders_nginx_server_name`, while inventory supplies the right values for each selected host. Secrets use Vault, and non-secret values stay visible for review.

When something looks wrong, the team can inspect the final host variables before running tasks. That habit turns variable debugging from guesswork into a short path: check the compiled host, find the source file, fix the scope, and verify the value again.

## What's Next

Inventory variables can also control connection details. `ansible_host`, `ansible_user`, SSH keys, ports, and privilege escalation settings all affect how Ansible reaches a machine and what it can do after login. The next article separates those layers so SSH failures and sudo failures stay readable.

---

**References**

- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [Encrypting content with Ansible Vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_encrypting_content.html)
- [ansible-vault command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-vault.html)
- [ansible-inventory command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
