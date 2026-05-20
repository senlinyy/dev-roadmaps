---
title: "Includes, Imports, and Collections"
description: "Choose imports, includes, and collections when Ansible reuse needs the right timing and source."
overview: "Ansible has several reuse tools. The main difference between imports and includes is when Ansible loads them."
tags: ["ansible", "imports", "includes", "collections"]
order: 3
id: article-infrastructure-as-code-ansible-includes-imports-collections
---

## Table of Contents

1. [Reuse Has Timing](#reuse-has-timing)
2. [Static Imports](#static-imports)
3. [Dynamic Includes](#dynamic-includes)
4. [Roles as Reuse](#roles-as-reuse)
5. [Collections](#collections)
6. [Choosing the Boundary](#choosing-the-boundary)
7. [Putting It All Together](#putting-it-all-together)

## Reuse Has Timing

The previous articles used roles to package the `orders` service. Roles are the large unit of reuse in Ansible, but they are not the only one. A playbook can also import task files, include task files, import roles, include roles, and use modules or roles shipped by collections.

These tools look similar because they all point Ansible at reusable content. The important difference is timing.

Static imports are loaded while Ansible parses the playbook. Ansible can see the imported tasks before the run begins. Dynamic includes are loaded while the playbook is running. Ansible reaches the include task, evaluates its conditions for the current host, and then loads the selected content.

That timing affects ordinary work:

- Whether `--list-tasks` can show the tasks before the run.
- Whether tags apply to the included tasks or only to the include task.
- Whether a file name can depend on a host fact.
- Whether the playbook is easy to inspect before it touches a host.

The syntax is small. The behavior difference is not.

## Static Imports

Use a static import when the structure is known ahead of time. An imported task file is always part of the playbook structure.

For the `orders` service, package setup might always happen before service configuration:

```yaml
- name: Import orders package tasks
  ansible.builtin.import_tasks: packages.yml
```

Ansible expands `packages.yml` when it parses the playbook. The imported tasks are visible to task listing and to tools that inspect the playbook before execution.

Static imports are a good fit for stable structure:

```text
orders setup
  packages.yml
  users.yml
  service.yml
```

If every `orders` web host should always run those task files, static imports make the playbook easier to read. The run structure is known before Ansible connects to a host.

The surprise is that conditions on imports behave differently from conditions on includes. With a static import, Ansible expands the tasks and applies the condition to the imported tasks. That can be useful, but it also means the tasks are still part of the parsed playbook.

## Dynamic Includes

Use a dynamic include when the decision belongs at run time. The include task runs for a host, evaluates its condition, and then loads the task file if needed.

The `orders` role may need different package tasks on Debian and Red Hat systems:

```yaml
- name: Include Debian package tasks
  ansible.builtin.include_tasks: packages-debian.yml
  when: ansible_facts["os_family"] == "Debian"

- name: Include Red Hat package tasks
  ansible.builtin.include_tasks: packages-redhat.yml
  when: ansible_facts["os_family"] == "RedHat"
```

This decision depends on host facts. A Debian host loads the Debian file. A Red Hat host loads the Red Hat file. That is a natural use for dynamic includes because the selected content is host-specific.

Dynamic includes can also use variable file names:

```yaml
- name: Include package tasks for the host family
  ansible.builtin.include_tasks: "packages-{{ ansible_facts['os_family'] | lower }}.yml"
```

This is compact, but compact is not always clearer. If the file naming rule is not obvious, explicit includes with conditions can be easier to review.

The tradeoff is inspectability. Some dynamically included tasks do not appear as ordinary tasks until the play reaches the include. That can make `--list-tasks` less complete and make tag behavior more surprising. Dynamic includes are powerful because they defer the decision. Use that power when the decision truly needs runtime information.

## Roles as Reuse

Roles also have static and dynamic forms.

The static form is the `roles` list:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  roles:
    - orders_web
```

This is the normal shape for service configuration. The playbook reader can see that `orders_web` is part of the play.

There is also `ansible.builtin.import_role`, which statically imports a role inside the task list:

```yaml
- name: Import orders web role
  ansible.builtin.import_role:
    name: orders_web
```

And there is `ansible.builtin.include_role`, which dynamically includes a role during the run:

```yaml
- name: Include orders web role for the canary host
  ansible.builtin.include_role:
    name: orders_web
  when: inventory_hostname == "orders-web-01"
```

Dynamic role inclusion is useful when the role decision depends on runtime state or a narrow host condition. For ordinary service setup, static role use is usually easier to inspect.

The same boundary rule applies here as with task files. If the role is always part of the play, keep it static. If Ansible should choose at runtime whether to run it, use a dynamic include and make the condition obvious.

## Collections

Collections package Ansible content. A collection can contain modules, roles, plugins, documentation, and other reusable pieces. The built-in modules used throughout these articles are in the `ansible.builtin` collection.

That is why the examples use full names such as:

```yaml
- name: Render orders Nginx site
  ansible.builtin.template:
    src: orders.conf.j2
    dest: /etc/nginx/conf.d/orders.conf
```

The full collection name is called the fully qualified collection name, or FQCN. It tells the reader exactly which module is being used. It also avoids ambiguity when another collection has a module with the same short name.

Projects often declare external collection dependencies in a requirements file:

```yaml
collections:
  - name: community.general
    version: ">=8.0.0,<9.0.0"
```

Pinning or constraining versions keeps automation more repeatable. Without a version rule, a fresh control node may install a newer collection than the one used during the last successful run.

Collections are source boundaries. If the `orders` role uses a module from another collection, the project needs to make that dependency visible. A playbook that works only because one engineer has a collection installed locally is not reproducible automation.

## Choosing the Boundary

The reuse tool should match the boundary of the work.

Use a role when the work is a reusable unit with tasks, templates, files, defaults, and handlers. Use a task import when a stable task list is part of the playbook structure. Use a task include when the task list depends on host facts or runtime conditions. Use a collection when the reusable content comes from a packaged source outside the project.

Too much reuse can make a simple playbook hard to read. Ten tiny task files can hide the shape of a service. A dynamic include with a variable file name can make it hard to know which files might run. A role dependency can hide major work behind a small role name.

You do not need every reuse feature in every playbook. A healthy reuse boundary lets a reader answer three questions:

- What work will this playbook run?
- When does Ansible decide to load that work?
- Where does the reused content come from?

If those answers are clear, the reuse boundary is probably healthy.

## Putting It All Together

The `orders` automation now has several reuse choices. The main service configuration belongs in the `orders_web` role. Always-run setup files can be static imports. Operating-system-specific package tasks can be dynamic includes because the selected file depends on host facts. External modules or roles should come from named collections with visible version requirements.

The important distinction is timing:

| Reuse tool | Loaded | Good fit |
|------------|--------|----------|
| `import_tasks` | Parse time | Stable task structure that is always part of the play. |
| `include_tasks` | Run time | Host-specific or condition-specific task files. |
| `roles` / `import_role` | Parse time | Normal role use that should be visible before the run. |
| `include_role` | Run time | Conditional role use based on runtime facts or host conditions. |
| Collections | Installed content source | Shared modules, roles, and plugins from a package boundary. |

Once the timing is clear, the choice becomes practical. Use static reuse when the structure is part of the design. Use dynamic reuse when the host or run decides. Use collections when the source is packaged content that the project must declare.

---

**References**

- [Reusing Ansible artifacts](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse.html)
- [Roles](https://docs.ansible.com/ansible/latest/playbook_guide/playbooks_reuse_roles.html)
- [Using collections](https://docs.ansible.com/ansible/latest/collections_guide/index.html)
- [ansible.builtin.import_tasks module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/import_tasks_module.html)
- [ansible.builtin.include_tasks module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/include_tasks_module.html)
- [ansible.builtin.import_role module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/import_role_module.html)
- [ansible.builtin.include_role module](https://docs.ansible.com/ansible/latest/collections/ansible/builtin/include_role_module.html)
