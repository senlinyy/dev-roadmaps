---
title: "Permissions & Users"
description: "Manage file permissions, ownership, user accounts, and groups to control access on Linux systems."
overview: "Use Linux users, groups, permissions, ACLs, and sudo rules to run a small API safely on a VM without giving every person or process full control."
tags: ["permissions", "users", "chmod", "sudo"]
order: 5
id: article-devops-foundation-linux-linux-basics-permissions-users
---

## Table of Contents

1. [Why Permissions Matter on the API VM](#why-permissions-matter-on-the-api-vm)
2. [Users, Groups, UID, and GID](#users-groups-uid-and-gid)
3. [Read `ls -l` Without Guessing](#read-ls--l-without-guessing)
4. [The `rwx` Rules for Files and Directories](#the-rwx-rules-for-files-and-directories)
5. [Change Permissions with `chmod`](#change-permissions-with-chmod)
6. [Change Ownership with `chown` and `chgrp`](#change-ownership-with-chown-and-chgrp)
7. [Service Users and Deploy Users](#service-users-and-deploy-users)
8. [ACLs and Shared Access](#acls-and-shared-access)
9. [Sudo with Least Privilege](#sudo-with-least-privilege)
10. [References](#references)

## Why Permissions Matter on the API VM
<!-- section-summary: Permissions decide which humans and processes can read, change, or execute files on the server. -->

The `inventory-api` VM has several different actors. Engineers connect over SSH. A `deploy` user places new releases under `/srv/inventory-api`. A service user runs the API process. Nginx reads its own config and proxies traffic. Root can change almost anything.

Linux permissions keep those actors separated. The API process should read its own code and config while Nginx config stays outside its write access. The deploy user should publish a new release and restart the API with limited root commands. Private keys should be readable only by the account that owns them.

This separation is practical. When a process gets compromised, permissions shape what the attacker can reach. When an engineer runs a mistaken command, permissions can stop the mistake from crossing into unrelated parts of the server.

## Users, Groups, UID, and GID
<!-- section-summary: Linux tracks accounts with numeric user IDs and groups with numeric group IDs, while names make them readable to humans. -->

A **user** is an account that owns processes and files. A **group** is a named collection used to share access. Linux stores users and groups internally as numbers: a UID for each user and a GID for each group. Names like `deploy` and `inventory` make those numbers readable.

The `id` command shows the current identity:

```bash
$ id deploy
uid=1001(deploy) gid=1001(deploy) groups=1001(deploy),1002(inventory)
```

The UID identifies the user. The primary GID identifies the default group for new files. The extra groups grant additional access. In this example, `deploy` also belongs to the `inventory` group, which can own shared application files.

Linux keeps local account records in `/etc/passwd` and group records in `/etc/group`. Password hashes usually live in `/etc/shadow`, which normal users cannot read. Many production servers integrate with central identity systems. The local files still matter for service accounts and emergency access.

For our VM, the account design can stay simple:

| Account or group | Purpose |
|---|---|
| `deploy` user | Receives releases and runs approved deploy commands |
| `inventory` group | Owns application files shared by deploy and service users |
| `inventory-api` user | Runs the API service with limited privileges |
| `www-data` or `nginx` user | Runs Nginx, depending on distribution |

This gives each job a name. When `ps`, `ls`, or `journalctl` shows a user, you can connect that identity back to its purpose.

## Read `ls -l` Without Guessing
<!-- section-summary: Long directory listings show file type, permissions, owner, group, size, and timestamp in one line. -->

`ls -l` is the first permission inspection command. A release directory might show:

```bash
$ ls -lah /srv/inventory-api
total 20K
drwxr-xr-x  5 root       root       4.0K Jun 24 09:00 .
drwxr-xr-x  3 root       root       4.0K Jun 10 12:00 ..
lrwxrwxrwx  1 deploy     inventory    32 Jun 24 09:10 current -> releases/20260624-091000
drwxrwsr-x  8 deploy     inventory 4.0K Jun 24 09:10 releases
-rw-r-----  1 root       inventory  320 Jun 24 08:55 config.env
```

The first column carries file type and permissions. The next columns show owner and group. The `config.env` file is owned by `root`, grouped into `inventory`, and readable by the owner and group. That shape lets root edit secrets while the API service can read them through group membership.

The permission string has ten characters:

```bash
-rw-r-----
```

The first character is the file type. `-` means regular file, `d` means directory, and `l` means symbolic link. The next three characters belong to the owner, the next three to the group, and the final three to everyone else.

For `-rw-r-----`, the owner can read and write. The group can read. Others have no access. This is a common shape for environment files that contain secrets.

## The `rwx` Rules for Files and Directories
<!-- section-summary: Read, write, and execute mean different things on files and directories, so directory execute permission is especially important. -->

Linux uses three basic permission bits: **read**, **write**, and **execute**. Their meaning changes depending on whether the path is a file or a directory.

For files:

| Bit | Meaning on a file |
|---|---|
| `r` | Read file contents |
| `w` | Modify file contents |
| `x` | Execute the file as a program or script |

For directories:

| Bit | Meaning on a directory |
|---|---|
| `r` | List names inside the directory |
| `w` | Create, rename, or delete entries inside the directory |
| `x` | Traverse through the directory by name |

Directory execute permission surprises beginners. A user can read a file only if they can also traverse every parent directory in the path. For example, reading `/srv/inventory-api/current/package.json` requires execute permission on `/srv`, `/srv/inventory-api`, and `/srv/inventory-api/current`.

That is why web and service directories often use `755` or `750`. The service needs to walk the path. The world may need no write access at all. A missing execute bit on one parent directory can create confusing "permission denied" errors even when the file itself looks readable.

## Change Permissions with `chmod`
<!-- section-summary: `chmod` changes permission bits using either symbolic notation or octal numbers. -->

`chmod` changes permissions. Symbolic notation describes changes with letters:

```bash
$ chmod u+x scripts/deploy-inventory-api.sh
$ chmod g-w /srv/inventory-api/config.env
$ chmod o-rwx /srv/inventory-api/config.env
```

`u` means owner, `g` means group, and `o` means others. `+` adds a permission, `-` removes one, and `=` sets an exact value.

Octal notation sets all bits at once. The numbers are built from read `4`, write `2`, and execute `1`.

| Octal | Permission | Common use |
|---|---|---|
| `600` | Owner read/write only | Private keys and secret files |
| `640` | Owner read/write, group read | App config read by a service group |
| `644` | Owner write, everyone read | Public non-secret config |
| `750` | Owner full, group read/execute | Private service directories |
| `755` | Owner full, everyone read/execute | Public program directories |

For the API VM, a reasonable config file permission is:

```bash
$ sudo chmod 640 /srv/inventory-api/config.env
```

A release directory often needs traversal for group members:

```bash
$ sudo chmod 2750 /srv/inventory-api/releases
```

The leading `2` sets the setgid bit on the directory. New files and directories created inside inherit the directory's group. That helps keep release files grouped under `inventory` even when the `deploy` user creates them.

## Change Ownership with `chown` and `chgrp`
<!-- section-summary: Ownership controls which user and group permission bits apply to each file. -->

`chown` changes the owning user and group. `chgrp` changes only the group. These commands usually require root privileges because ownership affects access control.

For the API directory:

```bash
$ sudo chown root:inventory /srv/inventory-api/config.env
$ sudo chown -R deploy:inventory /srv/inventory-api/releases
$ sudo chgrp inventory /srv/inventory-api/current
```

Recursive ownership changes deserve caution. `chown -R` walks a tree and changes everything inside it. Before using it, check the path with `pwd`, `ls -ld`, and maybe `find` so the command points at exactly the tree you intend.

Ownership and permissions work together. If `inventory-api` belongs to the `inventory` group, then a `640 root:inventory` config file gives the service read access without giving it write access. That is a clean production pattern: humans or deployment automation write config, while the running process only reads it.

## Service Users and Deploy Users
<!-- section-summary: A service user runs the application with limited access, while a deploy user performs controlled release tasks. -->

A **service user** is a Linux account dedicated to running one service. It usually has no interactive shell and no password login. Its job is ownership isolation. If the API process is compromised, the attacker lands inside the permissions of `inventory-api` instead of a human administrator account.

The account can be created like this:

```bash
$ sudo groupadd --system inventory
$ sudo useradd --system \
  --gid inventory \
  --home-dir /srv/inventory-api \
  --shell /usr/sbin/nologin \
  inventory-api
```

The deploy user is different. It may accept SSH keys from the CI/CD system or from trusted operators. It needs write access to release directories and carefully limited sudo for service operations.

```bash
$ sudo usermod -aG inventory deploy
$ sudo install -d -o deploy -g inventory -m 2775 /srv/inventory-api/releases
$ sudo install -d -o root -g inventory -m 0750 /srv/inventory-api
```

The `install -d` command creates directories with owner, group, and mode in one step. It is common in provisioning scripts because it avoids separate `mkdir`, `chown`, and `chmod` calls.

This split gives the deploy user enough power to publish code and the service user enough power to run code. Nginx remains separate under its own user, commonly `www-data` on Debian and Ubuntu or `nginx` on some Red Hat style systems.

## ACLs and Shared Access
<!-- section-summary: POSIX ACLs add specific user or group permissions when the owner-group-other model is too coarse. -->

Traditional permissions give one owner, one group, and one "others" set. That works most of the time. **POSIX ACLs** add more specific entries for named users or groups when one shared group is not enough.

First, inspect ACLs:

```bash
$ getfacl /srv/inventory-api/config.env
```

Grant a specific on-call user read access to the API config during an incident:

```bash
$ sudo setfacl -m u:maya:r /srv/inventory-api/config.env
```

Grant a group read and execute access to a directory:

```bash
$ sudo setfacl -m g:oncall:rx /srv/inventory-api
```

Default ACLs apply to new files created inside a directory:

```bash
$ sudo setfacl -d -m g:inventory:rx /srv/inventory-api/releases
```

ACLs are useful, but they can also hide access paths from people who only check `ls -l`. When a permission decision seems confusing, `getfacl` gives the full picture. For long-term access, a well-named group is often clearer than many one-off ACL entries.

## Sudo with Least Privilege
<!-- section-summary: `sudo` should grant the narrow admin commands a user needs rather than full root access by default. -->

`sudo` lets an authorized user run specific commands with elevated privileges. The broad version gives full root access, but production servers benefit from narrower rules. The deploy user may need to restart only `inventory-api`, reload Nginx after validation, and inspect service status.

Sudoers rules belong in files under `/etc/sudoers.d/` and should be edited with `visudo`, which checks syntax before saving:

```bash
$ sudo visudo -f /etc/sudoers.d/inventory-api-deploy
```

A scoped rule can look like this:

```sudoers
deploy ALL=(root) NOPASSWD: /bin/systemctl restart inventory-api, /bin/systemctl status inventory-api, /usr/sbin/nginx -t, /bin/systemctl reload nginx
```

This grants the deploy user exactly those commands as root. The exact paths must match the system. `command -v systemctl nginx` shows where binaries live.

Verification is part of the setup:

```bash
$ sudo -l -U deploy
```

Sudo logs also matter. On many distributions, authentication and sudo activity appears in `/var/log/auth.log` or through the journal:

```bash
$ sudo journalctl _COMM=sudo --since "today"
```

The practical goal is simple. Human users, deploy automation, service processes, and Nginx each receive only the access their job needs. That design keeps day-to-day operations smooth while limiting damage from mistakes and compromises.

## References

- [Linux `chmod(1)` manual](https://man7.org/linux/man-pages/man1/chmod.1.html) - Documents symbolic and octal permission changes.
- [Linux `chown(1)` manual](https://man7.org/linux/man-pages/man1/chown.1.html) - Documents changing file owner and group.
- [Linux `useradd(8)` manual](https://man7.org/linux/man-pages/man8/useradd.8.html) - Documents creating local users.
- [Linux `groupadd(8)` manual](https://man7.org/linux/man-pages/man8/groupadd.8.html) - Documents creating local groups.
- [Linux `acl(5)` manual](https://man7.org/linux/man-pages/man5/acl.5.html) - Documents POSIX ACL behavior.
- [sudoers manual](https://www.sudo.ws/docs/man/sudoers.man/) - Official sudoers policy documentation.
- [systemd service credentials and users](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) - Documents service execution settings including user and group controls.
