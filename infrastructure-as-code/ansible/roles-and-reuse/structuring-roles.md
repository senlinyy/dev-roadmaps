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

1. [The Problem: Monolithic Playbooks](#the-problem-monolithic-playbooks)
2. [Structuring a Role](#structuring-a-role)
3. [Conventional Directory Layout](#conventional-directory-layout)
4. [Under the Hood: Role Path Resolution](#under-the-hood-role-path-resolution)
5. [Defaults versus Vars: The Precedence Boundary](#defaults-versus-vars-the-precedence-boundary)
6. [Variable Namespacing and Namespace Pollution](#variable-namespacing-and-namespace-pollution)
7. [Asserting Required Inputs](#asserting-required-inputs)
8. [Role Dependencies and the Metadata Layer](#role-dependencies-and-the-metadata-layer)
9. [Putting It All Together](#putting-it-all-together)
10. [What's Next](#whats-next)

## The Problem: Monolithic Playbooks

An Ansible role is a named reusable unit with conventional task, variable, template, file, handler, and metadata directories.

When a system administration team first adopts Ansible, playbooks usually start as single files. A playbook designed to harden server security might begin by installing a firewall, editing the secure shell daemon configuration, setting up file integrity monitoring, and restarting the corresponding system services. This single-file approach works well when managing a small, uniform fleet of servers.

As the organization grows, other departments start using the same security playbook. The core engineering team, the database administration group, and the marketing operations team all have different requirements. For example, database hosts might need specific network ports left open, while public-facing web servers require strict firewall exclusions.

If the organization continues using the single-file playbook, developers are forced to copy and paste hundreds of lines of task blocks, variable definitions, and handlers into new playbook files. This copy-paste workflow introduces configuration drift. When a new security vulnerability requires an immediate change to the secure shell configuration, administrators must search through dozens of independent playbooks to apply the patch manually.

Ansible roles solve this problem by organizing automation into reusable directory structures. A role is a self-contained package of tasks, variables, templates, files, and handlers. By separating the generic system logic from environment-specific values, teams can share a single, hardened role across the entire organization without duplicating code.

## Structuring a Role

A role structure is the directory layout that keeps one reusable unit of automation together. It separates the task list from the variables, templates, static files, handlers, and metadata that the task list needs.

Example: a `security_hardening` role can keep SSH templates in `templates/`, restart logic in `handlers/`, and default ports in `defaults/`, while a playbook only says which hosts should use the role.

The following playbook applies a security hardening role to target web hosts. It passes only the high-level configuration parameters, leaving the low-level operating system actions to the role itself.

```yaml
- name: Apply security hardening to web servers
  hosts: webservers
  become: true
  roles:
    - role: security_hardening
      vars:
        security_hardening_ssh_port: 2222
        security_hardening_allowed_groups: ["admin", "webops"]
```

Inside the `security_hardening` role, the tasks are separated from default values and file templates. The main task list in `roles/security_hardening/tasks/main.yml` contains only the high-level module invocations.

```yaml
- name: Install system security packages
  ansible.builtin.apt:
    name: "{{ security_hardening_packages }}"
    state: present
    update_cache: true

- name: Configure secure shell daemon
  ansible.builtin.template:
    src: sshd_config.j2
    dest: /etc/ssh/sshd_config
    owner: root
    group: root
    mode: "0600"
  notify: Restart secure shell daemon

- name: Initialize host firewall
  ansible.builtin.template:
    src: ufw_rules.j2
    dest: /etc/ufw/user.rules
    owner: root
    group: root
    mode: "0640"
  notify: Reload host firewall
```

The default variables that configure these tasks are stored in `roles/security_hardening/defaults/main.yml`.

```yaml
security_hardening_ssh_port: 22
security_hardening_allowed_groups: ["admin"]
security_hardening_packages: ["ufw", "fail2ban", "auditd"]
```

The internal constants that should not be changed by callers are stored in `roles/security_hardening/vars/main.yml`.

```yaml
security_hardening_sshd_service: sshd
security_hardening_firewall_service: ufw
```

## Conventional Directory Layout

The conventional role layout is Ansible's expected folder map for reusable work. When a role is called, Ansible automatically searches for standard directories like `tasks/`, `defaults/`, `templates/`, and `handlers/`.

Example: if a task inside the role uses `src: sshd_config.j2`, Ansible looks in `roles/security_hardening/templates/` without requiring a long relative path.

A fully structured role contains the following standard directories:

```plain
roles/
  security_hardening/
    defaults/
      main.yml
    vars/
      main.yml
    tasks/
      main.yml
    handlers/
      main.yml
    templates/
      sshd_config.j2
      ufw_rules.j2
    files/
      audit_rules.conf
    meta/
      main.yml
```

Each directory in this structure has a dedicated purpose:

| Directory | Purpose |
|---|---|
| `defaults/` | Lowest-priority variables; the public input contract for the role, safe to override from outside |
| `vars/` | High-priority variables; internal constants tightly coupled to the role and not intended for external callers |
| `tasks/` | The ordered list of tasks the role executes; `main.yml` is the entry point |
| `handlers/` | Event-driven handlers notified by tasks inside this role |
| `templates/` | Jinja2 template files rendered and pushed to targets; the `template` module resolves sources here automatically |
| `files/` | Static files copied verbatim to targets; the `copy` module resolves sources here automatically |
| `meta/` | Role metadata including author information, supported platforms, and dependencies on other roles |

This layout makes the automation codebase predictable. If a security auditor requests a change to the secure shell configuration template, a developer knows immediately to open `templates/sshd_config.j2`. If a service fails to restart, the developer inspects `handlers/main.yml`.

```mermaid
graph TD
    subgraph Control Plane ["Control Node Execution Engine"]
        Playbook["playbook.yml"]
        PathResolution["Role Path Resolution"]
    end

    subgraph RoleStructure ["Role Directory: security_hardening"]
        TasksDir["tasks/main.yml"]
        DefaultsDir["defaults/main.yml"]
        VarsDir["vars/main.yml"]
        HandlersDir["handlers/main.yml"]
        TemplatesDir["templates/"]
        FilesDir["files/"]
    end

    Playbook -->|Calls Role| PathResolution
    PathResolution -->|Loads Tasks| TasksDir
    PathResolution -->|Loads Defaults| DefaultsDir
    PathResolution -->|Loads Vars| VarsDir
    PathResolution -->|Loads Handlers| HandlersDir

    TasksDir -->|Resolves Template Source| TemplatesDir
    TasksDir -->|Resolves File Source| FilesDir
    TasksDir -->|Triggers Notification| HandlersDir
```

## Under the Hood: Role Path Resolution

Role path resolution is how Ansible turns a role name into a real directory on the control node. The playbook uses the symbolic name, and Ansible searches the configured role locations to find the matching folder.

Example: `security_hardening` in a playbook normally resolves to `roles/security_hardening/` beside the playbook, while `acme.platform.security_hardening` resolves from an installed collection path.

For ordinary project roles, the most important location is the `roles/` directory beside the active playbook. If the playbook is located at `/srv/ansible/site.yml`, a project role named `security_hardening` normally lives at `/srv/ansible/roles/security_hardening/`.

Ansible also consults the configured `roles_path`, which can come from `ansible.cfg`, the `ANSIBLE_ROLES_PATH` environment variable, or Ansible's defaults. This setting often points to shared role repositories, such as `~/.ansible/roles/`, `/usr/share/ansible/roles/`, or `/etc/ansible/roles/`.

If the role is packaged inside an Ansible collection and you call it by its fully qualified collection name, such as `acme.platform.security_hardening`, Ansible resolves it from the installed collection paths instead of treating it as a local project role.

Once a matching directory is found, the absolute path is bound to an internal variable named `role_path`. All subsequent module calls within the role resolve relative paths using this `role_path` boundary.

For example, when a task in `tasks/main.yml` invokes the `template` module with `src: sshd_config.j2`, Ansible does not search the playbook directory or the current working directory. Instead, the engine prefixes the source parameter with the role path, resolving it directly to `role_path/templates/sshd_config.j2`.

This path resolution mechanism makes roles mostly self-contained. A role can be copied to a different control node, checked out into a temporary continuous integration directory, or installed via Ansible Galaxy, and it can still resolve its templates and files without relying on relative path helpers like `../../` inside the task definitions.

## Defaults versus Vars: The Precedence Boundary

Role defaults and role vars are both YAML files, but they have opposite jobs. Defaults are weak public inputs callers can override, while vars are strong internal values that callers should not normally change.

Example: `security_hardening_ssh_port: 22` belongs in `defaults/main.yml` if environments may change it to `2222`. A Debian-specific service name that the role must use internally can live in `vars/main.yml`.

Ansible uses a documented precedence hierarchy to resolve variable values during execution. The location of a variable determines its strength when competing against other variables with the same name.

Variables defined in `defaults/main.yml` occupy the weakest role variable tier. This means role defaults are intentionally easy to override. Inventory variables, group variables, host variables, playbook variables, and command-line extra variables can replace a role default.

This weakness is a deliberate design feature. Role defaults define the public input contract for the role. By placing default values in `defaults/main.yml`, the role author provides a safe, working fallback that allows the role to run out of the box in a development or staging environment. Callers can customize the role's behavior by overriding these defaults in their environment inventories or playbooks.

Variables defined in `vars/main.yml` have much stronger precedence than role defaults. They can override inventory values and many ordinary playbook values, which makes them a poor home for public configuration knobs.

Because role variables are strong, they should be used sparingly for internal constants. These are values that are mandatory for the role's internal operations and are not intended as normal caller inputs. For example, if a role is designed specifically to manage Nginx on a Debian platform, the path to the system configuration file may always be `/etc/nginx/nginx.conf`. Storing this path in `vars/main.yml` makes accidental inventory overrides much less likely.

The table below illustrates this precedence boundary:

| Parameter Type | Location | Precedence Strength | Caller Overridable | Architectural Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Role Defaults** | `defaults/main.yml` | Weakest | Yes, easily | Public configuration knobs, safe fallbacks, documentation of inputs. |
| **Role Vars** | `vars/main.yml` | Strong | Difficult for normal callers | Internal constants, platform-specific paths, private architectural settings. |

If you place a public configuration parameter, such as the secure shell port, inside `vars/main.yml`, a user trying to apply the role will find that their inventory overrides are ignored. This leads to frustration and forces users to modify the role's source code directly, breaking the principal benefit of reuse.

## Variable Namespacing and Namespace Pollution

Variable namespacing means prefixing variable names so each role owns a clear part of the shared variable space. Namespace pollution happens when generic names from different roles collide.

Example: `port` is risky because several roles may define it. `security_hardening_ssh_port` tells the reader which role owns the value and prevents accidental overlap with a database or web role.

This shared context introduces the risk of namespace pollution and variable collisions. If two different roles define a generic variable name like `port` or `service_name`, a stronger or later-loaded value can override the value another role expected. This can cause silent failures, where one service is configured using the network port intended for a completely different service.

To prevent namespace pollution, role authors must enforce namespacing by prefixing every variable, default, and handler name with the exact name of the role.

Consider the following bad example, where a role uses generic variable names:

```yaml
# Inside roles/security_hardening/defaults/main.yml (Bad)
ssh_port: 22
allowed_groups: ["admin"]
packages: ["ufw", "fail2ban"]
```

If another role in the same playbook, such as `database_setup`, also defines `packages` or `allowed_groups`, the values will collide.

The corrected example applies the role name as a prefix:

```yaml
# Inside roles/security_hardening/defaults/main.yml (Good)
security_hardening_ssh_port: 22
security_hardening_allowed_groups: ["admin"]
security_hardening_packages: ["ufw", "fail2ban"]
```

Enforcing this prefix pattern provides several structural benefits. Variables are much less likely to collide, even when a playbook executes dozens of different roles, because each role's variables occupy their own named namespace rather than competing in a shared flat pool. Developers can search the entire repository for the prefix `security_hardening_` to locate every file, template, and inventory entry that configures the role, making audits and dependency tracing straightforward. When a developer reads an environment inventory file, the prefix makes it immediately clear which role will consume each variable, turning the inventory into readable self-documenting configuration.

Namespacing should also be applied to handler names. When a task calls the `notify` directive, Ansible searches for a matching handler name or listen topic. If two roles define a handler named `Restart service`, the notification can become ambiguous during review and may trigger the wrong operational action. Prefixing handler names, such as `Restart security_hardening sshd`, keeps notifications easier to trace.

## Asserting Required Inputs

An assertion is an early validation task that checks whether required values exist and have safe shapes. It stops the role before any host changes are made if the caller forgot an important input.

Example: a security role can assert that `security_hardening_ssh_port` is an integer between `1` and `65535` before it edits `sshd_config`. While role defaults provide safe fallbacks, some configuration parameters are too sensitive or environment-specific to have a default value.

Leaving these variables undefined in `defaults/main.yml` is a good practice, but if a caller runs the playbook without supplying a value, the execution will fail midway through the run. A task deep inside the role will attempt to reference the undefined variable, resulting in an abrupt failure that can leave the target host in a partially configured state.

To prevent these partial failures, you should use the `ansible.builtin.assert` module at the very beginning of the role's task list to validate that all required inputs are present and meet the expected format.

The following example shows how to write a safety assertion block in `roles/security_hardening/tasks/main.yml`:

```yaml
- name: Validate that required security inputs are provided
  ansible.builtin.assert:
    that:
      - security_hardening_allowed_groups is defined
      - security_hardening_allowed_groups | length > 0
      - security_hardening_ssh_port is integer
      - security_hardening_ssh_port >= 1 and security_hardening_ssh_port <= 65535
    fail_msg: "The security_hardening role requires valid allowed groups and a port between 1 and 65535."
    quiet: true
```

By placing this assertion as the first task in `tasks/main.yml`, the role evaluates the caller's inputs before making any modifications to the target host. If a required variable is missing or contains an invalid port number, the play terminates immediately on the control plane, keeping the remote host safe from incomplete configuration.

Using assertions also documents the role's expectations. Instead of reading through hundreds of lines of templates to find what variables are required, a user can inspect the assertion block to see the validation rules.

## Role Dependencies and the Metadata Layer

A role dependency is another role that must run before the current role can work safely. The metadata layer is the `meta/main.yml` file where a role can declare those prerequisites.

Example: `security_hardening` can depend on `os_base_repos` so package repositories are configured before the security role tries to install `ufw`, `fail2ban`, or `auditd`.

Ansible supports role dependencies using the `meta/main.yml` file located within the role directory structure. The metadata layer allows the role author to declare that another role must be loaded and executed automatically before the parent role starts.

```yaml
# Inside roles/security_hardening/meta/main.yml
dependencies:
  - role: os_base_repos
    vars:
      os_base_repos_enable_updates: true
```

When the execution engine encounters a role containing dependency declarations, it resolves them recursively and runs the dependency roles before the role that declared them. Ansible also tracks role dependencies so the same dependency is not run repeatedly in the same context unless the role configuration requires a separate run.

While dependencies are highly powerful, they must be used with caution to avoid architectural problems. If role A depends on role B and role B depends on role A, the execution engine detects the circular reference and halts with a compiler error to prevent an infinite loop. When a playbook calls a single role that silently imports five other roles through metadata dependencies, the playbook reader loses visibility into what changes are actually being applied to their servers, making incidents harder to trace and playbook reviews harder to reason about. Dependent roles also share the host variable context, which increases the likelihood of variable collisions if namespacing prefixes are not maintained across every role in the chain.

For simple environments, declaring dependencies explicitly within the playbook's `roles` list is often cleaner than nesting them inside the metadata layer. Listing roles sequentially in the playbook, such as applying `os_base_repos` followed by `security_hardening`, makes the execution order immediately visible to anyone reviewing the repository.

## Putting It All Together

Structuring playbooks into reusable roles changes how systems automation is managed across an organization. Instead of maintaining large, fragile files, teams compile self-contained modules that follow a predictable directory layout.

This modular structure relies on four main principles:
- **Path Isolation**: The control plane resolves all internal templates, files, and handlers relative to the resolved `role_path`, eliminating the need for complex relative path statements.
- **Precedence Discipline**: Safe public defaults live in `defaults/main.yml`, while internal paths and operating system constants can live in `vars/main.yml`.
- **Namespace Cleanliness**: Prefixing variables, defaults, and handlers with the role name reduces collisions in Ansible's shared host variable context.
- **Dependency Awareness**: Using `meta/main.yml` to specify structural prerequisites while maintaining explicit sequential plays when visibility is preferred.

By enforcing these boundaries, you transform raw configuration files into a reliable infrastructure platform. Different teams can invoke the same security hardening role, passing custom variable overrides through their environments while trusting that the underlying system logic remains standardized, audited, and safe.

---

**References**

- [Ansible Roles Documentation](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html) - Core role directory structure, defaults, vars, handlers, templates, and meta conventions.
- [Understanding Variable Precedence](https://docs.ansible.com/ansible/latest/reference_appendices/general_precedence.html) - Explains how role defaults, role vars, and extra vars interact in the precedence chain.
- [Using Assertions for Playbook Validation](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/assert_module.html) - Covers the assert module for validating required variables before role execution begins.
- [Role Dependencies and Metadata](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html#role-dependencies) - Documents the meta/main.yml format for declaring role dependencies and controlling execution order.
