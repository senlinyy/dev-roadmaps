---
title: "Facts and Conditionals"
description: "Use Ansible facts and conditions to choose tasks based on what a host really is."
overview: "Facts are values Ansible gathers from a host. Conditions use those values to decide whether a task should run."
tags: ["ansible", "facts", "conditionals"]
order: 3
id: article-infrastructure-as-code-ansible-facts-conditionals
---

## Table of Contents

1. [What Facts Are](#what-facts-are)
2. [Gathering Facts](#gathering-facts)
3. [Inventory and Facts](#inventory-and-facts)
4. [Using Facts in Tasks](#using-facts-in-tasks)
5. [Conditions](#conditions)
6. [Missing and Expensive Facts](#missing-and-expensive-facts)
7. [Putting It All Together](#putting-it-all-together)
8. [What's Next](#whats-next)

## What Facts Are

Facts are values Ansible discovers from a managed host. They describe the machine Ansible connected to: operating system, distribution, architecture, memory, network interfaces, disks, Python version, and many other details.

For the orders service, inventory might say a host belongs to `orders_web`. Facts can say that the host is Ubuntu, uses the `Debian` OS family, has a certain IP address, and has a particular amount of memory. Inventory is what you told Ansible. Facts are what the host reports during the run.

Facts are stored under `ansible_facts`. A playbook can use them the same way it uses other variables:

```yaml
ansible_facts["os_family"]
ansible_facts["distribution"]
ansible_facts["default_ipv4"]["address"]
```

The useful idea is evidence. When a task needs to depend on what the host is, facts are usually better than guessing from a name.

## Gathering Facts

Many plays gather facts automatically at the start. Before normal tasks run, Ansible connects to each host and runs its fact-gathering step.

You can make the choice explicit:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  gather_facts: true
```

Fact gathering takes time because Ansible must ask each host for information. Some plays turn it off:

```yaml
- name: Restart orders workers
  hosts: orders_workers
  gather_facts: false
```

Turning it off is fine when the play does not use facts. A simple restart play may only need host targeting and a service name. But a task that reads `ansible_facts["os_family"]` needs facts to exist. If fact gathering is disabled and no cache or previous task provides the fact, the condition can fail or behave differently than expected.

## Inventory and Facts

Inventory and facts answer different questions.

| Source | Answers | Example |
|--------|---------|---------|
| Inventory | What role should this host have in our system? | `orders-web-01` belongs to `orders_web` |
| Facts | What does this host report about itself now? | `orders-web-01` reports `Debian` OS family |

Both can be true at the same time. The host can be an orders web host and an Ubuntu machine.

Use inventory when the value is part of your intended architecture. A host belongs to `orders_web` because the team assigned it that role. Use facts when the value should come from the host itself. Package manager choice, interface addresses, and platform-specific paths often depend on facts.

The practical surprise is that host names can lie. A host named `orders-ubuntu-01` may have been rebuilt as a Red Hat family machine. A condition based on the name would follow the old label. A condition based on `ansible_facts["os_family"]` follows the host's current report.

## Using Facts in Tasks

A simple debug task can show a fact while you are learning:

```yaml
- name: Show OS family
  ansible.builtin.debug:
    var: ansible_facts["os_family"]
```

Example output:

```text
ok: [orders-web-01] => {
    "ansible_facts[\"os_family\"]": "Debian"
}
```

Facts can also be used in templates. An orders Nginx config might bind to the host's default IPv4 address:

```nginx
listen {{ ansible_facts["default_ipv4"]["address"] }}:80;
server_name {{ orders_server_name }};
```

That can be useful, but it also makes the template depend on fact availability. If the host does not have a default IPv4 fact, the render can fail. Facts should be used because the host evidence is truly needed, not because they are available.

## Conditions

A condition tells Ansible whether a task should run. The common keyword is `when`.

For the orders web hosts, package installation may differ by operating system family:

```yaml
- name: Install nginx on Debian hosts
  ansible.builtin.apt:
    name: nginx
    state: present
  when: ansible_facts["os_family"] == "Debian"

- name: Install nginx on Red Hat hosts
  ansible.builtin.dnf:
    name: nginx
    state: present
  when: ansible_facts["os_family"] == "RedHat"
```

Each host evaluates the condition for itself. A Debian host runs the `apt` task and skips the `dnf` task. A Red Hat family host does the reverse.

Conditions can also use ordinary variables:

```yaml
- name: Enable orders maintenance page
  ansible.builtin.template:
    src: maintenance.html.j2
    dest: /usr/share/nginx/html/maintenance.html
  when: orders_maintenance_enabled | bool
```

Keep important conditions readable. A long expression with several nested tests becomes hard to review. If the logic is important, use clear variable names or split the work into smaller tasks.

One syntax detail matters: `when`, `changed_when`, and `failed_when` are already Jinja expressions. You normally write the expression directly, without wrapping the whole condition in `{{ }}`.

## Missing and Expensive Facts

Facts can be missing. A minimal container may not expose the same data as a full virtual machine. A network fact may require a system tool that is not installed. A play may have `gather_facts: false`. A fact may exist on Linux but not on a network device or another platform.

When a fact might be missing, write the condition defensively:

```yaml
- name: Configure Debian-specific orders package
  ansible.builtin.apt:
    name: nginx
    state: present
  when: ansible_facts.get("os_family") == "Debian"
```

This avoids an immediate undefined-key failure if `os_family` is absent. When the fact is missing or different, the task skips cleanly.

Fact gathering can also be expensive across many hosts. If a play only restarts a known service and does not use facts, disabling fact gathering can make the run faster:

```yaml
- name: Restart orders workers
  hosts: orders_workers
  gather_facts: false
  tasks:
    - name: Restart orders worker
      ansible.builtin.service:
        name: orders-worker
        state: restarted
```

The tradeoff is clarity. A play with `gather_facts: false` should avoid fact-dependent conditions. If a later task needs facts, turn gathering back on or gather the specific facts you need.

## Putting It All Together

For the orders service, facts and conditions let one playbook respond to real host differences:

- Inventory says which machines are orders web hosts.
- Fact gathering asks each host what it is.
- Tasks read facts when host evidence should decide behavior.
- Conditions choose whether each task runs for each host.
- Skipped output shows which tasks did not match a host's condition.

This lets a mixed fleet stay readable. You can keep one orders playbook while still choosing `apt` for Debian family hosts, `dnf` for Red Hat family hosts, or a different template path when a host reports a different platform.

## What's Next

The next article covers registered results. Facts are gathered host evidence. Registered results are task evidence captured during the run so later tasks can make decisions from what earlier tasks returned.

---

**References**

- [Discovering variables and facts](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_vars_facts.html)
- [Conditionals](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_conditionals.html)
- [Special variables: facts](https://docs.ansible.com/projects/ansible/latest/reference_appendices/special_variables.html#facts)
- [ansible.builtin.setup module](https://docs.ansible.com/projects/ansible/latest/collections/ansible/builtin/setup_module.html)
