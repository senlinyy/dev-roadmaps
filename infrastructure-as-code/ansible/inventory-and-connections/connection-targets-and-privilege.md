---
title: "Connection Targets and Privilege"
description: "Understand how Ansible chooses the host address, login user, and privilege escalation user."
overview: "Ansible connection failures are easier to read when address, login, and privilege are separate ideas."
tags: ["ansible", "ssh", "become", "privilege"]
order: 3
id: article-infrastructure-as-code-ansible-connection-targets-privilege
---

## Table of Contents

1. [The Problem](#the-problem)
2. [Three Separate Questions](#three-separate-questions)
3. [Connection Address](#connection-address)
4. [Remote User](#remote-user)
5. [Privilege Escalation](#privilege-escalation)
6. [Reading Failures](#reading-failures)
7. [Keeping Privilege Visible](#keeping-privilege-visible)
8. [Putting It All Together](#putting-it-all-together)
9. [What's Next](#whats-next)

## The Problem

An Ansible task can fail before the task logic has a chance to matter. The host may be wrong. The address may be stale. SSH may use the wrong account. Sudo may ask for a password that Ansible does not have. The task may need root, but the play may not request privilege escalation.

For the orders service, those layers are easy to mix together:

- `orders-web-01` is the right inventory name, but its `ansible_host` still points to a replaced machine.
- The control node can reach the host, but SSH tries to log in as the local laptop user instead of `deploy`.
- The `deploy` user can run the Ansible ping module, but cannot install `nginx`.
- A task writes `/etc/nginx/conf.d/orders.conf`, but the play does not use `become`.

These are different problems. Treating them as one vague "Ansible failed" problem makes debugging slow.

## Three Separate Questions

Before Ansible can change a Linux host, it has to answer three questions:

1. Which address should it connect to?
2. Which user should it log in as?
3. Should this task become another user, usually root?

Each answer can come from inventory, variables, playbook keywords, command-line options, or configuration. The first beginner habit is to keep the concepts separate even when Ansible gives you several ways to set them.

For the orders web hosts, the pieces might look like this:

```yaml
all:
  children:
    orders_web:
      hosts:
        orders-web-01:
          ansible_host: 10.40.10.21
        orders-web-02:
          ansible_host: 10.40.10.22
      vars:
        ansible_user: deploy
```

And the play might request privilege for system changes:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  tasks:
    - name: Install nginx
      ansible.builtin.apt:
        name: nginx
        state: present
```

The inventory name is what Ansible calls the host. `ansible_host` is where it connects. `ansible_user` is who it logs in as. `become: true` is how privileged tasks run after login.

## Connection Address

The inventory host name is the stable label. The connection address is the network target.

```yaml
orders-web-01:
  ansible_host: 10.40.10.21
```

Ansible output uses the inventory name:

```text
ok: [orders-web-01]
```

SSH uses the address. If `10.40.10.21` is stale, the output name may still look correct while the connection fails or reaches the wrong machine.

This split is useful when infrastructure changes. A virtual machine can be rebuilt with a new private IP while the inventory name stays `orders-web-01`. People reading play output still see the service host name. The inventory maintainer updates the address in one place.

The risk is stale data. Always inspect the merged host view when a connection target looks surprising:

```bash
ansible-inventory -i inventory/prod.yml --host orders-web-01
```

If the address is wrong there, no playbook task can fix the current run.

## Remote User

The remote user is the account Ansible uses for the initial login. In many projects, this is set as `ansible_user`.

```yaml
orders_web:
  vars:
    ansible_user: deploy
```

This says Ansible should log in to orders web hosts as `deploy`. The SSH key, host key checking, bastion path, and network access still have to work for that user.

The remote user should be predictable. A project where some commands use `ubuntu`, some use `deploy`, and some use `root` is hard to review. If a host really needs a different login user, make that difference visible in host variables and keep it rare.

The Ansible ping module is a useful access test:

```bash
ansible orders_web -i inventory/prod.yml -m ansible.builtin.ping
```

When it succeeds, Ansible has connected as the remote user, run a small module, and received a result. It still has not proven sudo access.

## Privilege Escalation

Many system tasks need root permissions. Installing packages, writing under `/etc`, creating system users, and managing services usually require privilege.

Ansible uses `become` for privilege escalation:

```yaml
- name: Configure orders web hosts
  hosts: orders_web
  become: true
  tasks:
    - name: Write orders nginx config
      ansible.builtin.template:
        src: orders.conf.j2
        dest: /etc/nginx/conf.d/orders.conf
        mode: "0644"
```

This does not mean Ansible logs in as root. It can log in as `deploy` and then use sudo for tasks that need elevated permissions.

The default become user is usually root, but Ansible lets you choose another user with `become_user`. That is useful for tasks that should run as an application account rather than root. For example, a task might create a cache directory as the `orders` user while package installation still needs root.

Privilege should match the task. A task that checks `http://localhost/health` does not need root. A task that writes `/etc/systemd/system/orders-api.service` probably does.

## Reading Failures

Connection failures and privilege failures look different. Read the result word first.

An unreachable host points to the connection layer:

```text
fatal: [orders-web-01]: UNREACHABLE! => {
    "msg": "Failed to connect to the host via ssh"
}
```

The task did not run. Start with address, DNS, SSH user, key, host key checking, VPN, bastion, and firewall.

A privilege failure means Ansible reached the host and then failed while trying to do something with more permission:

```text
fatal: [orders-web-01]: FAILED! => {
    "msg": "Missing sudo password"
}
```

Here, the address and login user may be fine. Check `become`, sudo rules for the remote user, whether a password is required, and how that password is supplied for the run.

A module failure after privilege succeeds points somewhere else:

```text
fatal: [orders-web-01]: FAILED! => {
    "msg": "No package matching 'ngnix' is available"
}
```

This is not an SSH problem or a sudo problem. The package name is wrong, or the remote package repositories do not contain it.

## Keeping Privilege Visible

Privilege is easy to hide by setting it broadly. A play with `become: true` on every task may work, but it can make review weaker because readers stop noticing which tasks truly need root.

For a small service playbook, play-level `become: true` is common when most tasks manage packages, system files, and services. For mixed playbooks, task-level privilege can be clearer:

```yaml
- name: Check orders health endpoint
  ansible.builtin.uri:
    url: http://127.0.0.1/health

- name: Reload nginx
  become: true
  ansible.builtin.service:
    name: nginx
    state: reloaded
```

The first task reads an HTTP endpoint. The second task controls a system service. The privilege boundary is visible in the file.

Another practical surprise is that variables can override connection behavior. `ansible_user`, `ansible_become`, and related connection variables can come from inventory, group vars, host vars, or other sources. If Ansible uses a different user than expected, inspect the merged host values instead of only reading the playbook.

## Putting It All Together

For the orders hosts, connection and privilege become much easier to read when the layers stay separate:

- `orders-web-01` is the inventory name Ansible prints.
- `ansible_host` is the address SSH uses.
- `ansible_user` is the account used for the initial login.
- `become` controls whether a task escalates privilege after login.
- `UNREACHABLE` points to the connection layer.
- `FAILED` after connection points to privilege, module arguments, remote state, or task logic.

The first debugging question is not "why did Ansible fail?" It is "which layer failed?"

## What's Next

The next article covers patterns, limits, and canary runs. Once connection and privilege are clear, the next safety question is how many hosts a command should touch.

---

**References**

- [Connecting to hosts: behavioral inventory parameters](https://docs.ansible.com/projects/ansible/latest/inventory_guide/intro_inventory.html#connecting-to-hosts-behavioral-inventory-parameters)
- [Understanding privilege escalation: become](https://docs.ansible.com/projects/ansible/latest/playbook_guide/playbooks_privilege_escalation.html)
- [Controlling how Ansible behaves: precedence rules](https://docs.ansible.com/projects/ansible/latest/reference_appendices/general_precedence.html)
- [ansible command line reference](https://docs.ansible.com/projects/ansible/latest/cli/ansible.html)
