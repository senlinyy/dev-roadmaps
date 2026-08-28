---
title: "Groups and Host Variables"
description: "Use group and host variables to keep Ansible values near the machines they describe."
overview: "Inventory can store values as well as host names. Those values should live at the narrowest useful scope."
tags: ["ansible", "inventory", "variables"]
order: 2
id: article-infrastructure-as-code-ansible-groups-host-variables
---

## Table of Contents

1. [Why Do Inventory Values Need a Home?](#why-do-inventory-values-need-a-home)
2. [How Should Variable Files Be Organized?](#how-should-variable-files-be-organized)
3. [What Belongs in Group Variables?](#what-belongs-in-group-variables)
4. [What Belongs in Host Variables?](#what-belongs-in-host-variables)
5. [How Does Ansible Choose the Effective Value?](#how-does-ansible-choose-the-effective-value)
6. [Where Should Secrets Live?](#where-should-secrets-live)
7. [How Do You Verify and Roll Back Values?](#how-do-you-verify-and-roll-back-values)
8. [How Do You Design a Maintainable Value Map?](#how-do-you-design-a-maintainable-value-map)
9. [Check Your Answers](#check-your-answers)

Inventory starts as a host map, then real work adds values. The application web servers need an application port, an Nginx server name, a service user, a log directory, and a package version. Staging and production need different domains, and one older production host may need a temporary data path until it is rebuilt.

**Group variables** and **host variables** give those values a clear home. A group variable applies to every host in a group, while a host variable applies to one inventory host. The playbook can stay focused on the task, and the inventory can describe the differences between environments, roles, and one-machine exceptions.

That separation is what lets one playbook configure both staging and production. The template task can render `{{ application_app_port }}` every time, while the value comes from the right inventory files for the selected host. The playbook remains one source of behavior instead of becoming a pile of copied environment-specific versions.

Keep these questions in view as you work through the lesson:

1. **Why Do Inventory Values Need a Home?**
2. **How Should Variable Files Be Organized?**
3. **What Belongs in Group Variables?**
4. **What Belongs in Host Variables?**
5. **How Does Ansible Choose the Effective Value?**
6. **Where Should Secrets Live?**
7. **How Do You Verify and Roll Back Values?**
8. **How Do You Design a Maintainable Value Map?**

## Why Do Inventory Values Need a Home?
<!-- section-summary: Group and host variables let the inventory describe environment values without copying playbooks. -->

Start with a simple equation:

```text
reusable automation + effective values for one host = concrete desired state
```

The role or task defines the operation. Inventory variables inject the environment, service, and host context. This is similar to dependency injection in application code: the reusable component declares the inputs it consumes, and the caller supplies values without rewriting the component.

Without a value map, teams tend to hard-code environment data into roles or copy the playbook. A production hostname appears inside a template task, a staging variant changes one line, and soon fixes must be synchronized across several nearly identical files. `group_vars` and `host_vars` preserve one behavior while moving changing data into reviewable scopes.

There are three important inventory layers:

```text
all or broad groups       fleet-wide and environment-wide policy
specific groups           service, role, region, or platform policy
individual host           genuine machine-specific exception
```

A host receives data from every group it belongs to, not only one “primary” group. A production API host may inherit company settings from `all`, environment settings from `production`, and service settings from `application_api`. Ansible accumulates those sources into the host's effective variable context.

This makes the ownership question more useful than “where can Ansible technically read this value?” Ask who owns it. A company-wide monitoring endpoint belongs with fleet policy. A production public domain belongs with the production environment. A reusable role's fallback belongs in role defaults. A temporary storage mount used by one machine belongs in its host file. A release version supplied for one deployment may belong to the pipeline run.

Variables are data, not actions. Setting `application_service_enabled: true` does nothing by itself; a task or role must read that value and converge a service. Keeping that boundary clear prevents inventory from becoming a hidden, fragmented workflow definition.

## How Should Variable Files Be Organized?
<!-- section-summary: A predictable inventory directory makes host membership, group values, and host exceptions easy to review. -->

Most teams start with a simple layout and grow into a directory per environment. Each environment directory contains a host map and two optional variable directories. `group_vars` stores values for groups, and `host_vars` stores values for individual hosts.


![Variables Directory Shape](/content-assets/articles/article-infrastructure-as-code-ansible-groups-host-variables/variables-directory-shape.png)

*The directory view shows how group_vars, host_vars, and Vault files sit beside inventory so values stay close to the machines they describe.*

```yaml
inventories/
  staging/
    hosts.yml
    group_vars/
      all.yml
      staging_web.yml
      staging_workers.yml
    host_vars/
      application-stg-web-01.yml
  prod/
    hosts.yml
    group_vars/
      all.yml
      prod_web.yml
      prod_workers.yml
    host_vars/
      application-web-02.yml
```

This layout gives reviewers quick clues before they read the YAML. A change under `inventories/prod/group_vars/prod_web.yml` affects production web hosts. A change under `inventories/prod/host_vars/application-web-02.yml` affects one host, so the reviewer can ask why that machine needs special treatment.

The path also helps operators during incidents. If the order web port looks wrong on `application-web-02`, the team can check the host file first, then the web group file, then the environment-wide `all.yml`. The files line up with the questions people ask under pressure.

File names are part of the lookup contract. `group_vars/prod_web.yml` corresponds to the inventory group named `prod_web`; `host_vars/application-web-02.yml` corresponds to that exact inventory identity. A friendly DNS alias or `ansible_host` address does not change which host file loads. If the inventory identity is `application-web-02`, a file named after its IP address will not automatically apply.

The same lookup can use a directory instead of one file:

```text
group_vars/
└── production/
    ├── settings.yml
    ├── packages.yml
    └── vault.yml
```

Splitting a group directory can keep ordinary settings, package policy, and encrypted data separate while preserving the same group scope. `host_vars/application-web-02/` can likewise contain several files for one host. File order and duplicate variable names can introduce conflicts, so use directories to organize clear ownership rather than to scatter one value across several candidates.

The location of `group_vars` and `host_vars` also matters. In a repository with an inventory directory per environment, placing them beside that environment's `hosts.yml` keeps production and staging data isolated. Ansible can also load variable directories relative to a playbook, but mixing placement styles without a convention makes it harder to predict which files a given command will load.

Start debugging from the inventory identity and the exact `-i` source. Confirm that the group exists, the host belongs to it, and the file or directory name matches exactly. A visually correct YAML file that is outside the loader's search path contributes nothing to the effective context.

Keep the host map and value files separately readable. Membership changes answer “which nodes inherit this policy?” Variable changes answer “what policy will those members receive?” Reviewers need both views, but combining hundreds of settings inline with the host graph makes either question harder to answer.

## What Belongs in Group Variables?
<!-- section-summary: Group variables define shared values once for every host in a role, environment, or platform slice. -->

A **group variable** applies to every host in an inventory group. Use it for values that are true for all hosts in that group: application ports, service names, package channels, log endpoints, feature flags, timezone settings, and environment labels.

For the production web group, the application team might define the values needed by Nginx, systemd, and the application config template:

```yaml
application_environment: production
application_service_user: application
application_app_port: 9000
application_app_root: /opt/application
application_config_dir: /etc/application
application_nginx_server_name: application.example.com
application_package_version: "2026.06.12"
```

Now the web role can use the same variable names for every environment. Production supplies `application_nginx_server_name: application.example.com`, while staging supplies `application_nginx_server_name: staging-application.example.com`. The tasks stay free of environment-specific branches for normal differences.

```yaml
- name: Render application application config
  ansible.builtin.template:
    src: application.yml.j2
    dest: "{{ application_config_dir }}/application.yml"
    owner: "{{ application_service_user }}"
    group: "{{ application_service_user }}"
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
        application-web-01:
        application-web-02:

# inventories/prod/group_vars/prod_web.yml
application_app_port: 9000
application_nginx_server_name: application.example.com
application_api_log_level: warn

# inventories/prod/host_vars/application-web-02.yml
application_api_log_level: debug
```

For this run, `application-web-01` receives `warn`, and `application-web-02` receives `debug`. That one-host exception should have a reason and an expiry, because host variables are easy to forget after the incident is over.

`group_vars/all.yml` is useful for values that truly apply to every loaded host, such as an organization domain, a universal time source, or a monitoring switch. It is not a convenient dumping ground. A database setting placed in `all` becomes visible to network devices, workers, and unrelated services, increasing collision risk and making the value's owner unclear.

Environment groups carry environment policy:

```yaml
# group_vars/production.yml
application_environment: production
application_log_endpoint: logs.prod.internal.example.com
application_change_window: sunday-0200-utc
```

Service-role groups carry the inputs shared by that role:

```yaml
# group_vars/application_api.yml
application_api_package: application-api
application_api_port: 9000
application_api_config_dir: /etc/application-api
```

A host in both groups accumulates both sets. Overlap is a feature when groups represent independent dimensions. The same node can receive production policy and API policy without a combined `production_application_api` file that duplicates every setting. Region, platform, and rollout groups can add other dimensions when they own real values or queries.

Sibling groups that define the same variable with different values make their overlap risky. If a host belongs to `blue` and `green`, and both define `application_api_port`, the intended winner is unclear to a reviewer. Ansible has inventory precedence controls, but the better architecture is usually to give the value one owner or redesign the groups so they do not express competing truths.

Role defaults are not group variables. A role default says, “this reusable role can operate with this overridable fallback.” A group variable says, “this fleet or environment intentionally chooses this value.” For example:

```yaml
# roles/application_api/defaults/main.yml
application_api_port: 8080
application_api_log_level: info

# group_vars/production.yml
application_api_port: 9000
application_api_log_level: warning
```

The production group is exercising the role's public input interface. Keeping defaults generic lets the same role serve staging, production, and test inventories without importing one environment's policy.

Templates make the separation visible. A template can render `{{ application_api_port }}` and `{{ application_api_log_level }}` without knowing which groups supplied them. Tasks use the same values for module arguments. Group variables do not run anything; a selected task, condition, loop, or template must consume them before they affect the run.

Connection variables such as `ansible_user`, `ansible_port`, and `ansible_python_interpreter` follow the same data-flow model, even though they influence how Ansible reaches the host before ordinary modules run. Put shared connection context in a suitable group and genuine legacy exceptions at the host level, while keeping credentials protected.

## What Belongs in Host Variables?
<!-- section-summary: Host variables should make one-machine exceptions visible and temporary. -->

A **host variable** applies to one inventory host. Use it for exceptions that truly belong to one machine: a temporary data directory, a migration flag, a special SSH port, a different disk mount, or a maintenance window for a host that has unusual customer traffic.

For example, `application-web-02` may still use an old attached disk during a storage migration. The group default says the data directory is `/var/lib/application`, and the host file overrides only the value that differs.

```yaml
application_data_dir: /mnt/legacy-application-data
application_storage_migration_ticket: INC-48291
application_maintenance_window: sunday-0200-utc
```

The playbook can keep rendering `{{ application_data_dir }}` without knowing which host supplied the value. Most web hosts receive the group value, and `application-web-02` receives the host value until the migration finishes.

Host variables should be easy to explain. If five web hosts need the same value, move it to the group. If a host variable stays around after the migration ticket closes, remove it in a cleanup pull request so the inventory stops teaching future readers that the exception is normal.

Good host values are tied to a stable identity and a real deviation: a unique storage device, a legacy interpreter, a one-node maintenance window, a primary-database property, or a migration flag that genuinely applies to one machine. Add context such as a ticket, owner, or expiry when the value is temporary, but keep the YAML value itself usable by automation.

Before creating a host exception, ask whether the difference is actually shared. If several hosts need feature X, define a `feature_x_hosts` group and place the value in `group_vars/feature_x_hosts.yml`. The group makes the cohort queryable, lets a play or limit select it, and prevents copy-pasted host files from drifting.

Too many host exceptions are a design smell. They may reveal that groups fail to model a platform generation, region, storage class, or rollout cohort. They can also reveal unmanaged snowflake servers that should be rebuilt toward a shared baseline. Host variables make deviations possible; they should not normalize the absence of fleet design.

Avoid copying every group value into each host file. Doing so destroys the main benefit of inheritance. A change to the common service port would require editing every host, and a missed file would create silent drift. The host file should contain only what differs, allowing removal of the exception to restore the group policy automatically.

Inventory host variables are declared intent, not discovered facts. Do not write the detected operating system, memory size, or network interface into `host_vars` merely because tasks need it. Ansible facts can observe changing machine state. Use host data for a deliberate override or an external truth that inventory owns; use facts for what the machine can report about itself.

## How Does Ansible Choose the Effective Value?
<!-- section-summary: Variable precedence decides which copy wins when the same variable name appears in several places. -->

Ansible has **variable precedence**, which means some variable sources override others when the same name appears more than once. The full table can wait until you need it, and the practical habit starts right away: keep each important value in one narrow, explainable place.


![Group Host Variable Resolution](/content-assets/articles/article-infrastructure-as-code-ansible-groups-host-variables/group-host-variable-resolution.png)

*The resolution flow makes the winning value visible when defaults, group settings, host exceptions, and release inputs all mention the same setting.*

For inventory variables, host-specific values override broader group values. A value in `host_vars/application-web-02.yml` can override a value from `group_vars/prod_web.yml` for that one host. More explicit runtime values, such as extra variables passed with `-e`, can override many other sources, so they deserve careful handling.

Here is a common production shape:

```yaml
# inventories/prod/group_vars/all.yml
application_environment: production
application_log_endpoint: logs.prod.internal.example.com
```

```yaml
# inventories/prod/group_vars/prod_web.yml
application_app_port: 9000
application_data_dir: /var/lib/application
```

```yaml
# inventories/prod/host_vars/application-web-02.yml
application_data_dir: /mnt/legacy-application-data
```

When Ansible prepares `application-web-02`, it resolves `application_data_dir` to `/mnt/legacy-application-data`. When it prepares `application-web-01`, `application_data_dir` remains `/var/lib/application`. That is useful, and it also means hidden duplicate values can surprise people.

Specific names reduce confusion. `port` is too vague in a real project because Nginx, the app, metrics, and admin endpoints may all have ports. Names like `application_app_port`, `nginx_listen_port`, and `node_exporter_port` tell readers which system consumes the value and make debug output easier to search.

Precedence exists because a host can receive several claims about one name. Within inventory, a host-specific value is more specific than a group value. Child-group data is more specific than parent-group data. Sibling groups are harder because neither is naturally the other's child; relying on their conflict order makes the design less obvious.

The full variable precedence table includes sources outside inventory—role defaults, play variables, task variables, registered values, role parameters, `set_fact`, and extra variables. You do not need to memorize every level to design well. Start by minimizing duplicate definitions, place each value with its owner, and treat every intentional override as part of the interface.

Extra variables passed with `-e` sit at very high precedence. They are useful for a release number or explicit emergency override, but they can make a run differ from the repository's visible configuration. Record them with the deployment and do not build normal production operation around a long, hidden list of CLI values.

Ansible's behavior is better described as accumulation plus conflict resolution than classical object-oriented inheritance. A host collects values from all applicable sources. When names are unique, all those values coexist. Only duplicate names require a winner. The cleanest data flow therefore gives independent group dimensions independent variable names whenever their policies are independent.

A useful ownership strategy is:

```text
role default     reusable fallback
all group        truly universal policy
environment      environment-owned policy
service group    service-owned policy
host             one-machine deviation
Vault source     sensitive value
pipeline -e      one-run explicit input
```

This strategy makes the effective value explainable without treating precedence as architecture. If an operator must consult the full precedence appendix for every ordinary setting, the repository has too many competing owners.

For one host, the effective context can be written as an equation:

```text
role defaults
+ values from every matching group
+ host-specific exceptions
+ later play and runtime sources
→ conflict resolution
→ effective variables used by tasks
```

That is why inspecting the final host view is more reliable than opening one likely file. The file shows one input; Ansible executes with the resolved result.

## Where Should Secrets Live?
<!-- section-summary: Sensitive values need an encrypted workflow, while variable names should stay searchable for reviewers. -->

Some inventory values are sensitive. Database passwords, API tokens, become passwords, private keys, and webhook secrets should use a secret workflow instead of plain YAML. In Ansible projects, **Ansible Vault** is the built-in way to encrypt files or individual variable values.

For small projects, encrypting one variable can be enough:

```bash
ansible-vault encrypt_string --name application_database_password
```

That command prompts for the secret value and prints encrypted YAML that can be placed in a variable file. The variable name stays visible, while the value is protected.

```yaml
application_database_password: !vault |
  $ANSIBLE_VAULT;1.1;AES256
  3639343961383762346334373862316539316632666239653533366639366536
  3137373633343238313466363138353534663332316136310a37626539386433
```

Many production teams keep sensitive values in a separate vaulted file such as `group_vars/prod_web/vault.yml`, then keep safe defaults or variable names in a readable file such as `group_vars/prod_web/main.yml`. That pattern helps reviewers see which secrets exist without exposing the secret values.

Vault password handling also needs a team decision. A developer laptop may prompt for a Vault password, while Automation Controller or another CI system should use a managed credential. The important part is that secret access is auditable and separate from normal inventory review.

In CI or Automation Platform, the Vault password should come from a protected credential, a Vault ID, or a password client script. The repository can show `application_database_password` as a name, while the value stays encrypted or supplied at runtime. Debug tasks should print safe metadata such as whether a value is defined, not the value itself.

Vault solves storage encryption. It does not change the variable's scope or precedence. A vaulted value under `group_vars/production/` still becomes a production group variable after decryption, and a higher-precedence source can still replace it. Encryption protects the serialized value in Git; normal variable semantics apply during execution.

A common split keeps readable configuration and encrypted values together without mixing their review surfaces:

```text
group_vars/production/
├── settings.yml
└── vault.yml
```

`settings.yml` can refer to a clearly named secret input:

```yaml
application_database:
  host: database.prod.internal.example.com
  username: application
  password: "{{ vault_application_database_password }}"
```

The encrypted `vault.yml` defines `vault_application_database_password`. The prefix communicates that ordinary configuration consumes a protected value, while the non-secret file remains readable in review.

Vault is not automatically a complete secrets-management architecture. The team still needs password distribution or Vault IDs, access control, rotation, audit, CI integration, and a response plan for exposed plaintext. A larger organization may retrieve secrets from a dedicated manager instead. The important variable-design rule remains: keep sensitive values out of ordinary plaintext inventory and make their injection path explicit.

Vault protects data at rest, not every place the decrypted value can travel. A template may write it to a host, a module may send it to an API, and debug or diff output may print it. Use `no_log: true` around sensitive task arguments, protect rendered files with appropriate ownership and modes, and avoid broad dumps such as `hostvars[inventory_hostname]` in shared logs.

Do not verify a secret by printing it. Verify that the expected name is defined, that the consuming task succeeds, and that the destination enforces the intended behavior. Production logs, CI artifacts, terminal scrollback, and copied incident transcripts can all outlive the run that exposed them.

## How Do You Verify and Roll Back Values?
<!-- section-summary: ansible-inventory and small debug plays show the final values before a role uses them. -->

The safest way to debug variables is to inspect what Ansible compiled for one host. Start with `ansible-inventory --host` because it shows the merged values for that host without running your role.

```bash
ansible-inventory -i inventories/prod --host application-web-02
```

If the output shows `application_data_dir` as `/mnt/legacy-application-data`, the host override is active. If the value is missing, check the inventory path, group name, host name, file name, YAML indentation, and whether the host actually belongs to the group that owns the variable.

For a focused check, a short ad hoc command can print a non-secret variable. Keep this away from passwords and tokens because command output often lands in terminal scrollback, CI logs, and chat transcripts.

```bash
ansible -i inventories/prod application-web-02 -m ansible.builtin.debug -a "var=application_data_dir"
```

For playbook validation, run check mode when the modules support it. Check mode can show which templates or packages would change, and diff mode can show rendered file differences for supported modules. Treat it as a strong preview, then still use a canary before touching the whole group.

```bash
ansible-playbook -i inventories/prod deploy-application-web.yml --limit application-web-02 --check --diff
```

When the rollback is a value rollback, keep the target narrow. Restore the previous variable file or remove the stale host override, run `ansible-inventory --host application-web-02`, run the playbook with `--limit application-web-02 --check --diff`, and only then apply. That sequence proves the winning value changed before any host receives the rendered file.

### How failures reveal the wrong value source
<!-- section-summary: Variable failures usually point to missing names, wrong scope, YAML mistakes, or emergency overrides. -->

Variable problems tend to leave recognizable clues. An `undefined variable` error means the selected host never received the name the task expected. A rendered config with a staging domain in production usually means the wrong inventory path or group file was loaded. A value that changes only on one host often points to `host_vars`.

YAML mistakes are also common. A host under the wrong indentation level may leave a group empty, and an unquoted value such as `yes`, `no`, or an old-style version number can be parsed differently than a human expected. Quoting application versions and strings with special characters keeps reviews and rendered templates more predictable.

Rollback starts by restoring the value source that introduced the problem. If the bad value came from `group_vars/prod_web.yml`, revert that inventory change and rerun `ansible-inventory --host` for a representative host. If the problem came from a one-host override, remove the host variable and verify that the group value returns.

Runtime overrides need extra care. Extra variables passed with `-e` are powerful, and they can hide what the repository says. If an incident run used `-e application_package_version=2026.06.11`, write that into the deployment record and remove the override from the next normal run so the team returns to the repository value.

Variable debugging is data-flow debugging. Trace the host's inventory identity, memberships, matching group and host files, role defaults, play inputs, and runtime overrides until the final value is accounted for. Do not begin by editing the template merely because the wrong value became visible there; the template may have rendered its input correctly.

Verify group membership as well as values:

```bash
ansible-inventory -i inventories/prod --graph
ansible-inventory -i inventories/prod --host application-web-02
ansible-playbook -i inventories/prod deploy-application-web.yml --list-hosts
```

The graph proves which policies can apply. The host view shows the accumulated result. The play preview proves that the intended identity will actually execute the tasks that consume those values. Together they test the full path before mutation.

If a filename appears correct but its value is absent, check exact inventory names and group names. `host_vars` follows `inventory_hostname`, not `ansible_host` and not necessarily DNS. `group_vars` follows the inventory group name. A connection alias that looks similar to a host identity is not a substitute for that identity.

Previewing with `--check --diff` is valuable for templates and supported modules, but treat sensitive files carefully because diff can reveal secret-derived content. Use canary hosts, disable unsafe diff output, and verify the service after the real run. A preview confirms likely file changes, not the behavior of every external command or service restart.

Rollback should remove the bad input at its owner. Revert a group policy at the group, delete an expired host exception at the host, or stop passing a bad runtime override. Then re-inspect the effective host context before applying. Restoring the source without confirming the winner can leave a higher-precedence value active.

## How Do You Design a Maintainable Value Map?
<!-- section-summary: Clean variable placement lets one playbook adapt to environments while keeping exceptions and secrets visible. -->

The application platform now has a host map and a value map. Environment-wide values live in `group_vars/all.yml`, production web values live in `group_vars/prod_web.yml`, and the temporary storage exception for `application-web-02` lives in one host file with a ticket number beside it.


![Groups Host Vars Summary](/content-assets/articles/article-infrastructure-as-code-ansible-groups-host-variables/groups-host-vars-summary.png)

*The summary connects shared settings, host exceptions, secrets, verification, and rollback into one variable-placement checklist.*

The playbook stays readable because it uses stable variable names. Templates refer to `application_app_port`, `application_data_dir`, and `application_nginx_server_name`, while inventory supplies the right values for each selected host. Secrets use Vault, and non-secret values stay visible for review.

When something looks wrong, the team can inspect the final host variables before running tasks. That habit turns variable debugging from guesswork into a short path: check the compiled host, find the source file, fix the scope, and verify the value again.

A complete repository can express the data flow without duplicating the role:

```text
roles/application_api/defaults/main.yml
inventories/prod/group_vars/all.yml
inventories/prod/group_vars/production.yml
inventories/prod/group_vars/application_api.yml
inventories/prod/host_vars/application-api-03.yml
playbooks/deploy-application.yml
```

The role defaults provide `application_api_port: 8080`, four workers, and an `info` log level. `group_vars/all.yml` supplies the organization domain and monitoring endpoint. `group_vars/production.yml` chooses production logging and release policy. `group_vars/application_api.yml` chooses the service package, port `9000`, and config path. The host file changes only the data path for one migration host.

The source files might look like this:

```yaml
# roles/application_api/defaults/main.yml
application_api_port: 8080
application_api_worker_count: 4
application_api_log_level: info
application_api_data_dir: /var/lib/application-api
```

```yaml
# inventories/prod/group_vars/all.yml
organization_domain: example.com
monitoring_endpoint: monitoring.internal.example.com
```

```yaml
# inventories/prod/group_vars/production.yml
application_environment: production
application_api_log_level: warning
application_release_channel: stable
```

```yaml
# inventories/prod/group_vars/application_api.yml
application_api_package: application-api
application_api_port: 9000
application_api_config_dir: /etc/application-api
```

```yaml
# inventories/prod/host_vars/application-api-03.yml
application_api_data_dir: /mnt/migration/application-api
migration_ticket: INC-48291
```

The playbook does not restate those choices:

```yaml
---
- name: Configure the application API
  hosts: application_api:&production
  become: true
  roles:
    - application_api
```

The role consumes its inputs in tasks and templates:

```yaml
- name: Install the application package
  ansible.builtin.package:
    name: "{{ application_api_package }}"
    state: present

- name: Render application configuration
  ansible.builtin.template:
    src: application-api.conf.j2
    dest: "{{ application_api_config_dir }}/application-api.conf"
    mode: "0640"
```

For `application-api-01`, the compiled context includes port `9000`, warning logging, the stable release channel, and the default data directory. For `application-api-03`, every one of those values remains the same except the data directory. The exception stays small enough that removing its host file after migration restores the role default automatically.

Notice what is absent. The role does not contain `if production` branches for ordinary values. The inventory does not contain package-install tasks. The host exception does not duplicate the production and service files. Each layer owns one kind of decision.

For `application-api-01`, the role starts with its fallback and the matching groups add their intentional choices. The service group replaces port `8080` with `9000`; no host exception exists. For `application-api-03`, the same values accumulate, then the host file replaces the data path. The play and role remain identical for both machines.

```text
application-api-01:
  port     = 9000 from service group
  data dir = shared service value

application-api-03:
  port     = 9000 from service group
  data dir = migration host exception
```

That is the useful inheritance-plus-override model: shared policy is declared once, and a narrow deviation replaces only the field that differs. It is not a license to redefine the whole configuration at every level.

Several common mistakes become visible from this model:

- Hard-coding production data in a role makes the reusable fallback environment-specific.
- Putting everything in `group_vars/all` gives unrelated hosts values they do not own.
- Copying full group configuration into `host_vars` turns inheritance into manual duplication.
- Using precedence as the main architecture creates several competing sources for ordinary values.
- Keeping secrets beside plaintext configuration blurs access and review boundaries.
- Copying machine facts into host files confuses declared intent with observed reality.
- Assuming a source filename is the winner ignores every other applicable source.

A first-principles decision tree is more durable than memorizing paths:

```text
Does the reusable role need a fallback?
  → role defaults

Is the value truly universal in this inventory?
  → group_vars/all

Does an environment, service, region, or platform own it?
  → the matching group

Does exactly one stable host intentionally differ?
  → host_vars, with a reason

Is the value sensitive?
  → encrypted or external secret source at the same logical scope

Does the value belong only to this deployment event?
  → explicit recorded runtime input

Was the value observed from the machine?
  → facts or a registered task result, not inventory duplication
```

The deeper question is always ownership. Scope should follow the smallest stable set whose owner can state the value as policy. “Narrowest possible” is not the goal if it causes every host to repeat a shared truth. “Broadest convenient” is not the goal if it leaks values into unrelated roles. Choose the narrowest **useful shared scope**, then represent true exceptions explicitly.

You can verify this concrete flow without exposing secrets:

```bash
ansible-inventory -i inventories/prod --host application-api-01
ansible-inventory -i inventories/prod --host application-api-03
ansible-playbook -i inventories/prod playbooks/deploy-application.yml --list-hosts
ansible-playbook -i inventories/prod playbooks/deploy-application.yml \
  --limit application-api-03 --check --diff
```

Compare the two host views. Most values should match; the documented migration field should be the deliberate difference. If additional differences appear, trace their owning groups before running the role. This side-by-side review is a practical way to detect accidental host drift.

When the migration finishes, remove `application_api_data_dir` and its ticket from the host file, inspect the host again, and confirm that `/var/lib/application-api` returns from the role default. The rollback is not a copied replacement value; it is removal of the exception so normal policy becomes effective again.

Overlapping groups deserve a final concrete check. Suppose the same host belongs to `production`, `application_api`, `eu_west`, and `canary`. These memberships are healthy when they own different concerns:

```yaml
# group_vars/production.yml
application_environment: production

# group_vars/application_api.yml
application_api_port: 9000

# group_vars/eu_west.yml
monitoring_region: eu-west

# group_vars/canary.yml
application_rollout_cohort: canary
```

All four values accumulate without conflict. If both `production` and `canary` instead define `application_api_port`, the model no longer says which group owns port policy. Adding a priority knob can force a winner, but it does not resolve the conceptual ambiguity. Move the port to its service group or create an explicitly named override variable consumed by rollout logic.

Parent and child groups can represent a clearer specificity relationship. A parent `web` group may define common Nginx settings, while child `production_web` and `staging_web` groups choose environment domains. The child choice is understandable because the hierarchy says it specializes the parent. Two unrelated siblings making competing claims are harder to justify.

The flow from repository to module is therefore:

```text
inventory establishes identity and memberships
                    ↓
Ansible loads matching group_vars and host_vars
                    ↓
role, play, task, fact, and runtime sources join the context
                    ↓
precedence resolves duplicate names
                    ↓
Jinja expressions evaluate for this host
                    ↓
modules receive concrete arguments
```

At each arrow, debugging asks a different question. Was the correct identity loaded? Did it join the correct groups? Did matching filenames load? Did a later source override the name? Did Jinja transform the value? Did the module receive the expected concrete argument? Walking this pipeline prevents a downstream symptom from being “fixed” at the wrong layer.

Values also need stable types. A group may define a real boolean while an emergency `-e key=false` supplies the string `"false"`; a condition can then behave differently from what the operator intended. Use YAML or JSON for typed runtime inputs, quote version strings that must remain strings, and keep lists and dictionaries structurally consistent across overrides. An override should replace a value, not quietly change its type contract.

The shortest reliable mental model is: groups express shared policy, hosts express deviations, roles express reusable defaults, and precedence is only the conflict resolver. If precedence frequently determines ordinary design intent, reorganize ownership until the winner is evident from the data model itself.

This model also makes code review more precise. A role-default change affects every caller that has not overridden the input. A group-variable change affects every current and future member of that group. A host-variable change affects one stable identity. A runtime override affects one recorded execution. Reviewers should evaluate the blast radius at the source's scope, not only the number of changed lines.

For temporary exceptions, the safest lifecycle has four visible stages: introduce the host value with a reason, verify its resolved value, operate while the exception is needed, and remove it when the shared policy becomes valid again. Leaving the host file behind after remediation creates configuration archaeology—future operators see a special value but cannot tell whether it remains required.

Finally, do not let convenience erase access boundaries. Non-secret group policy should remain readable to the people reviewing fleet behavior. Encrypted values and external credentials should be accessible only to approved operators or automation identities. Splitting these files is not merely aesthetic; it lets teams review ordinary configuration broadly without broadening access to production secrets.

Inventory variables can also control connection details. `ansible_host`, `ansible_user`, SSH keys, ports, and privilege escalation settings all affect how Ansible reaches a machine and what it can do after login. The next article separates those layers so SSH failures and sudo failures stay readable.

A variable interface also needs deprecation discipline. When renaming a role input, accept or detect the old name for a bounded transition, fail clearly when both are supplied, migrate every inventory, and then remove the compatibility path. Silently supporting two names forever creates another precedence problem.

Review resolved types as well as values. A quoted number, string boolean, or differently shaped dictionary can appear reasonable in YAML and behave differently in conditions, templates, or modules. Argument specifications and early assertions make the host context a validated contract rather than an untyped bag of overrides.

Group precedence should not be used to simulate ordered layering among unrelated dimensions. If region, service, and rollout cohort all need to contribute to one structured configuration, give each an owned field or merge them explicitly in a documented data model. Depending on sibling group load order makes a later inventory plugin or naming change capable of altering production policy without an obvious variable edit.

Host exceptions should have deletion criteria. Record what future state makes the exception unnecessary—a completed migration, rebuilt image, upgraded platform, or closed incident—and include cleanup in that work. An exception without an exit condition becomes undocumented permanent architecture.

Inventory variables should express intended differences, not reimplement live discovery. A value such as a service port belongs in `group_vars`; a fact such as `ansible_processor_vcpus` describes the inspected host and may help derive a default, but it should not silently redefine business intent. After rendering configuration, a handler can use `ansible.builtin.service`, and `ansible.builtin.wait_for` can bound a readiness wait. Keep those behaviors in the play or role while inventory supplies only the changing values.

## Check Your Answers

:::expand[Why Do Inventory Values Need a Home?]{kind="recap"}
Variable placement separates reusable behavior from changing context. A host accumulates fleet, environment, service, and exception data into one effective input set.
:::

:::expand[How Should Variable Files Be Organized?]{kind="recap"}
Name group and host files after exact inventory identities, keep environment directories distinct, and use subdirectories only to organize one clear scope.
:::

:::expand[What Belongs in Group Variables?]{kind="recap"}
Group variables express shared policy for stable sets such as environments and services. Overlapping dimensions should accumulate independent values rather than compete for the same name.
:::

:::expand[What Belongs in Host Variables?]{kind="recap"}
Host variables hold genuine one-machine deviations. Repeated exceptions should become a group or prompt a fleet-design fix, and copied facts should remain facts.
:::

:::expand[How Does Ansible Choose the Effective Value?]{kind="recap"}
Ansible accumulates applicable sources and resolves duplicate names by precedence. Minimize conflicts, assign one owner, and treat runtime overrides as visible exceptions.
:::

:::expand[Where Should Secrets Live?]{kind="recap"}
Keep secrets in Vault or an approved external system at the correct logical scope. Encryption protects storage, while `no_log`, file permissions, and careful verification protect use.
:::

:::expand[How Do You Verify and Roll Back Values?]{kind="recap"}
Inspect the graph, one host's resolved variables, and the play target list. Roll back the owning source, then verify the effective winner before applying again.
:::

:::expand[How Do You Design a Maintainable Value Map?]{kind="recap"}
Put fallbacks in role defaults, shared policy in meaningful groups, deviations in host files, secrets in protected sources, and one-run inputs in recorded runtime data.
:::

---

**References**

- [How to build your inventory](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html)
- [Using variables](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_variables.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [Encrypting content with Ansible Vault](https://docs.ansible.com/projects/ansible/latest/vault_guide/vault_encrypting_content.html)
- [ansible-vault command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-vault.html)
- [ansible-inventory command](https://docs.ansible.com/projects/ansible/latest/cli/ansible-inventory.html)
