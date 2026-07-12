---
title: "Permissions & Users"
description: "Manage file permissions, ownership, user accounts, and groups to control access on Linux systems."
overview: "Use Linux users, groups, permissions, ACLs, and sudo rules to run services without giving every person or process full control."
tags: ["permissions", "users", "chmod", "sudo"]
order: 5
id: article-devops-foundation-linux-linux-basics-permissions-users
---

## Table of Contents

1. [How Linux Permissions Control Access](#how-linux-permissions-control-access)
2. [Users, Groups, UID, and GID](#users-groups-uid-and-gid)
3. [Read Long Listings Without Guessing](#read-long-listings-without-guessing)
4. [The `rwx` Rules for Files and Directories](#the-rwx-rules-for-files-and-directories)
5. [Change Permissions with `chmod`](#change-permissions-with-chmod)
6. [Change Ownership with `chown` and `chgrp`](#change-ownership-with-chown-and-chgrp)
7. [Service Users and Deploy Users](#service-users-and-deploy-users)
8. [ACLs and Shared Access](#acls-and-shared-access)
9. [Sudo with Least Privilege](#sudo-with-least-privilege)
10. [References](#references)

## How Linux Permissions Control Access
<!-- section-summary: Users, groups, ownership, and permission bits decide which humans and processes can read, change, or execute files. -->

The first permission problem many beginners hit is painfully ordinary. You SSH into a server as `deploy`, try to copy a release into `/srv/web`, and Linux replies with `Permission denied`. The directory exists. The command looks right. The missing piece is who Linux thinks you are allowed to be in that directory.

Linux answers access questions by asking who is doing the work first. That "who" may be a human SSH account such as `deploy`, a service account such as `app`, or the root account during administration. A **user** is the account behind a running process or a file owner.

Some work needs to be shared. The deploy account and the application service may both need access to the same release directory. A **group** gives several accounts one shared identity for file access.

Every file and directory records an owning user and an owning group. That is **ownership**. The final piece is the permission bits that say what the owner, group, and everyone else may do: read, write, or execute.

This matters on any shared Linux server. Engineers may connect over SSH. A `deploy` user may place new releases under `/srv/web`. An `app` service user may run the application. Nginx may read its own config and logs. Root can change almost anything, so normal work should use narrower accounts whenever possible.

The goal is to give each job enough access to do its work. The application process should read its own code and config while staying unable to rewrite Nginx config. The deploy user should publish a release and restart the service through approved commands. Private keys should be readable only by the account that owns them.

## Users, Groups, UID, and GID
<!-- section-summary: Linux tracks accounts with numeric user IDs and groups with numeric group IDs, while names make them readable to humans. -->

Keep the same failed deploy in mind. The `deploy` account writes new releases, and the `app` account runs the service from those releases. Both accounts need to touch the same tree, but they do different jobs. The deploy account needs write access during release. The app account needs enough access to run the code afterward.

A **user** is one account, such as `deploy` or `app`. A **group** is a named collection used to share access, such as `web`. If both accounts belong to the `web` group, files owned by that group can be shared without giving access to every local user.

Linux shows friendly names to humans, and the kernel stores numeric IDs underneath. Each user has a UID. Each group has a GID. A process runs with a UID and one or more GIDs. A file stores an owning UID, an owning GID, and permission bits. When a process opens a file, the kernel compares those numbers and chooses the owner, group, or others permission set.

Ask Linux what identity a user has:

```bash
id deploy

# Example output:
# uid=1001(deploy) gid=1001(deploy) groups=1001(deploy),1002(web)
```

The output has three important pieces:

- `uid=1001(deploy)` is the user ID and user name.
- `gid=1001(deploy)` is the primary group for new files.
- `groups=1001(deploy),1002(web)` lists all groups this user belongs to.

The `groups=` field is useful during access debugging. If `deploy` cannot write into `/srv/web/releases`, check whether `groups=` includes `web`. If it does, inspect the directory mode and ownership next. If it does not, the account is missing the shared group membership.

Linux keeps local account records in `/etc/passwd` and group records in `/etc/group`. Password hashes usually live in `/etc/shadow`, which normal users cannot read. Many production servers integrate with central identity systems. The local files still matter for service accounts and emergency access.

A common production symptom is a file that shows the right user name on one server and only a number on another. That usually means the file stores a UID or GID that the second server cannot map to a local name. The next decision is to fix the account mapping or change ownership to an account that exists on that machine.

For a small server, the account design can stay simple:

| Account or group | Purpose |
|---|---|
| `deploy` user | Receives releases and runs approved deploy commands |
| `web` group | Owns application files shared by deploy and service users |
| `app` user | Runs the application service with limited privileges |
| `www-data` or `nginx` user | Runs Nginx, depending on distribution |

This gives each job a name. When `ps`, `ls`, or `journalctl` shows a user, you can connect that identity back to its purpose.

## Read Long Listings Without Guessing
<!-- section-summary: Long directory listings show file type, permissions, owner, group, size, and timestamp in one line. -->

After `id deploy` tells you the user's groups, inspect the path that failed. A permission problem usually starts with one simple question: who owns this file, and what is each identity allowed to do with it? A long listing puts the important clues in one line: file type, permission bits, owner, group, size, timestamp, and name. That makes it the bridge between a vague error such as "permission denied" and a safe fix.

The first inspection command is `ls -l`. Use `-a` for hidden files and `-h` for readable sizes:

```bash
ls -lah /srv/web

# Example output:
# total 20K
# drwxr-xr-x  5 root   root 4.0K Jun 24 09:00 .
# drwxr-xr-x  3 root   root 4.0K Jun 10 12:00 ..
# lrwxrwxrwx  1 deploy web    32 Jun 24 09:10 current -> releases/20260624-091000
# drwxrwsr-x  8 deploy web  4.0K Jun 24 09:10 releases
# -rw-r-----  1 root   web   320 Jun 24 08:55 config.env
```

Focus on `config.env` first:

```console
-rw-r-----  1 root   web   320 Jun 24 08:55 config.env
```

That one line contains the access story.

- `-rw-r-----` is the file type and permissions.
- `root` is the owning user.
- `web` is the owning group.
- `320` is the size in bytes.
- `Jun 24 08:55` is the modification time.

The permission string has ten characters:

```console
-rw-r-----
```

The first character is the file type. `-` means regular file, `d` means directory, and `l` means symbolic link. The next three characters belong to the owner, the next three to the group, and the final three to everyone else.

For `-rw-r-----`, the owner can read and write. The group can read. Others have no access. With `root:web` ownership, this means root can edit the file, members of the `web` group can read it, and unrelated local users cannot open it.

Now notice the release directory:

```console
drwxrwsr-x  8 deploy web  4.0K Jun 24 09:10 releases
```

The leading `d` says it is a directory. The `s` in the group execute position means the directory has the setgid bit. New files created inside tend to inherit the `web` group, which helps keep release files shareable by the right accounts.

![Permission string anatomy infographic explaining file type, owner bits, group bits, other bits, owner, group, and timestamp](/content-assets/articles/article-devops-foundation-linux-linux-basics-permissions-users/permission-string-anatomy.png)

_The image breaks one `ls -l` line into the exact permission fields operators inspect during access debugging._

## The `rwx` Rules for Files and Directories
<!-- section-summary: Read, write, and execute mean different things on files and directories, so directory execute permission is especially important. -->

The next confusing case appears when the file itself looks readable. The file may show `-rw-r--r--`, which appears open to everyone, yet `cat /srv/web/current/package.json` still returns `Permission denied`.

That happens because Linux checks every directory in the path before it reaches the file. A user needs permission to traverse `/srv`, then `/srv/web`, then `/srv/web/current`, and only then can Linux apply the file permissions.

Linux uses three basic permission bits: **read**, **write**, and **execute**. Their meaning changes depending on whether the path is a file or a directory. A file needs read and write controls for its bytes. A directory needs controls for the list of names it contains and for moving through that part of the tree.

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

Directory execute permission surprises beginners. A user can read a file only if they can also traverse every parent directory in the path. Reading `/srv/web/current/package.json` requires execute permission on `/srv`, `/srv/web`, and `/srv/web/current`.

You can inspect one path at a time:

```bash
ls -ld /srv /srv/web /srv/web/current

# Example output:
# drwxr-xr-x  3 root   root 4096 Jun 10 12:00 /srv
# drwxr-x---  5 root   web  4096 Jun 24 09:00 /srv/web
# lrwxrwxrwx  1 deploy web    32 Jun 24 09:10 /srv/web/current -> releases/20260624-091000
```

In this output, `/srv/web` gives the group `web` read and execute access. A user outside that group cannot list or traverse it. This is a common shape for private service directories.

The symptom is usually "Permission denied" even when the file itself looks readable. The file may be `644`, and the parent directory may be `750` with the wrong group. The next decision is to inspect every parent directory with `ls -ld` before changing the file mode.

![Directory rwx model infographic comparing read, write, and execute behavior on files versus directories](/content-assets/articles/article-devops-foundation-linux-linux-basics-permissions-users/directory-rwx-model.png)

_The image shows why `rwx` means different things on files and directories, which is the part that usually causes surprises._

## Change Permissions with `chmod`
<!-- section-summary: `chmod` changes permission bits using either symbolic notation or octal numbers. -->

A common deploy failure is direct. The script is right there in the directory, and the shell still refuses to run it:

```console
./scripts/deploy.sh: Permission denied
```

If the file exists and the path is correct, the missing piece may be the execute bit. A shell script can be readable as text and still refuse to run directly.

`chmod` changes permission bits. Use it after the right account and group own the path. A deploy script may need execute permission. An environment file may need group read access. Unrelated local users may need no access.

Symbolic notation describes changes with letters:

```bash
chmod u+x scripts/deploy.sh
```

This adds execute permission for the owner. Check the result:

```bash
ls -l scripts/deploy.sh

# Example output:
# -rwxr--r-- 1 deploy web 842 Jun 24 09:10 scripts/deploy.sh
```

The owner permissions changed from `rw-` to `rwx`, so `deploy` can run the script.

Remove group write and all access for others from a config file:

```bash
chmod g-w,o-rwx /srv/web/config.env
```

The letters are small once you learn them:

- `u` means owner.
- `g` means group.
- `o` means others.
- `+` adds a permission.
- `-` removes a permission.
- `=` sets an exact permission set.

Octal notation sets all bits at once. The numbers are built from read `4`, write `2`, and execute `1`.

| Octal | Permission | Common use |
|---|---|---|
| `600` | Owner read/write only | Private keys and secret files |
| `640` | Owner read/write, group read | App config read by a service group |
| `644` | Owner write, everyone read | Public non-secret config |
| `750` | Owner full, group read/execute | Private service directories |
| `755` | Owner full, everyone read/execute | Public program directories |

A reasonable config file permission is:

```bash
sudo chmod 640 /srv/web/config.env
```

Check it:

```bash
ls -l /srv/web/config.env

# Example output:
# -rw-r----- 1 root web 320 Jun 24 08:55 /srv/web/config.env
```

The mode `640` has three digits:

- `6` is read `4` plus write `2`, so the owner can read and write.
- `4` gives the group read access.
- `0` gives others no access.

A release directory often needs traversal for group members and inherited group ownership for new files:

```bash
sudo chmod 2750 /srv/web/releases
```

Check the directory:

```bash
ls -ld /srv/web/releases

# Example output:
# drwxr-s--- 8 deploy web 4096 Jun 24 09:10 /srv/web/releases
```

The leading `2` sets the setgid bit on the directory. The `s` in the group execute position shows it is active. New files and directories created inside inherit the directory's group, which helps keep release files grouped under `web`.

Setgid exists to make shared directories less fragile. Without it, a file created by `deploy` may take the `deploy` primary group, while the service reads files through the `web` group. With setgid on `/srv/web/releases`, new release files stay grouped under `web`, so the service and deploy flow keep sharing the same tree. If new files appear with the wrong group, check the setgid bit before adding broad write access.

## Change Ownership with `chown` and `chgrp`
<!-- section-summary: Ownership controls which user and group permission bits apply to each file. -->

After permission bits, ownership is the other half of the same error. Someone copies files as root, the release lands under `/srv/web/releases`, and now the deploy user cannot update it. The app service may also fail to open its expected config. The permission bits may look reasonable while the owner and group point at the wrong identities.

Ownership decides which permission triplet applies. `chown` changes the owning user and group. `chgrp` changes only the group. These commands usually require root privileges because ownership affects access control.

Set a secret config file to `root:web`:

```bash
sudo chown root:web /srv/web/config.env
```

Check it:

```bash
ls -l /srv/web/config.env

# Example output:
# -rw-r----- 1 root web 320 Jun 24 08:55 /srv/web/config.env
```

This shape lets root edit the file and lets members of `web` read it. Combined with `640`, it keeps unrelated users out.

Sometimes the owner is already correct, and only the group is wrong. In that case, `chgrp` is the smaller tool because it changes only the group:

```bash
sudo chgrp web /srv/web/config.env
```

Check the result:

```bash
ls -l /srv/web/config.env

# Example output:
# -rw-r----- 1 root web 320 Jun 24 08:55 /srv/web/config.env
```

That output tells you:

- `root` still owns the file, so the editing owner did not change.
- `web` is now the owning group, so members of the `web` group can use the group permission bits.
- `-rw-r-----` still keeps everyone outside the owner and group from opening the file.

Use `chgrp` when the user owner is already right and the shared group is the only mistake. Use `chown user:group` when both pieces need correction.

Set ownership on release files:

```bash
sudo chown -R deploy:web /srv/web/releases
```

Recursive ownership changes deserve caution. `chown -R` walks a tree and changes everything inside it. Check the path before using it:

```bash
pwd

# Example output:
# /srv/web
```

```bash
ls -ld /srv/web/releases

# Example output:
# drwxr-s--- 8 deploy web 4096 Jun 24 09:10 /srv/web/releases
```

If the path is correct, the recursive change is easier to reason about. If the path is wrong, stop before the command touches the wrong tree.

## Service Users and Deploy Users
<!-- section-summary: A service user runs the application with limited access, while a deploy user performs controlled release tasks. -->

Once you can read and change file permissions, the server design question is which account should do each job. Running an app as root can hide permission mistakes during setup, then create a much larger risk later. A safer shape gives the running service its own account and gives the deploy workflow a different account for releases.

A **service user** is a Linux account dedicated to running one service. It usually has no interactive shell and no password login. Its job is isolation. If the application process is compromised, the attacker lands inside the permissions of `app` instead of a human administrator account.

Service users exist because processes need identities too. systemd starts a service as a chosen user, and every file read, socket bind, and subprocess from that service carries that identity. A service user should own only the access the service needs, not a human's SSH keys, shell history, or sudo access.

Create the shared group:

```bash
sudo groupadd --system web
```

Create the service account:

```bash
sudo useradd --system \
  --gid web \
  --home-dir /srv/web \
  --shell /usr/sbin/nologin \
  app
```

Check the account:

```bash
id app

# Example output:
# uid=998(app) gid=997(web) groups=997(web)
```

Each flag supports a safer service shape:

- `groupadd --system web` creates a system group for application files.
- `useradd --system` creates a system account rather than a normal human login account.
- `--gid web` sets the service user's primary group to `web`.
- `--home-dir /srv/web` records the application directory as the account home.
- `--shell /usr/sbin/nologin` prevents interactive shell login for the service account.

The deploy user is different. It may accept SSH keys from CI/CD or trusted operators. It needs write access to release directories and carefully limited sudo for service operations.

Add `deploy` to the shared group:

```bash
sudo usermod -aG web deploy
```

Create the release directory with owner, group, and mode in one command:

```bash
sudo install -d -o deploy -g web -m 2775 /srv/web/releases
```

Check the directory:

```bash
ls -ld /srv/web/releases

# Example output:
# drwxrwsr-x 8 deploy web 4096 Jun 24 09:10 /srv/web/releases
```

The deploy commands have a few sharp edges:

- `usermod -aG web deploy` appends `deploy` to the supplementary `web` group. The `-a` means append. Without it, `-G` can replace the user's existing supplementary group list.
- `install -d` creates a directory if it is missing.
- `-o deploy` sets the owner, `-g web` sets the group, and `-m 2775` sets permissions while creating the directory.
- `2775` keeps setgid on the directory, gives owner and group full access, and gives others read and execute.

This design gives the deploy user enough power to publish code and the service user enough power to run code. Nginx stays under its own user, commonly `www-data` on Debian and Ubuntu or `nginx` on some Red Hat style systems.

The production symptom is a service that works only when run as root. That usually means the service needs a narrower permission fix: a readable config file, an executable directory path, a writable data directory, or a specific capability. The next decision is to inspect the failing path and grant the smallest access to the service user or group.

## ACLs and Shared Access
<!-- section-summary: POSIX ACLs add specific user or group permissions when the owner-group-other model is too coarse. -->

Sometimes the owner-group-other layout is almost right, and one incident creates an exception. One extra engineer needs temporary read access to `/srv/web/config.env`. Changing the file to a broad group or opening it to everyone would solve the moment and weaken the normal access design.

Traditional permissions give one owner, one group, and one "others" set. That works most of the time. **POSIX ACLs** add more specific entries for named users or groups when one shared group is not enough.

ACLs are best for exceptions. They let you grant one user or one extra group access without changing the main owner, main group, or public permissions. Linux still applies a mask to many ACL entries, so the listed permission and the effective permission may differ.

First inspect ACLs:

```bash
getfacl /srv/web/config.env

# Example output:
# # file: srv/web/config.env
# # owner: root
# # group: web
# user::rw-
# group::r--
# other::---
```

This output shows the same access you saw in `ls -l`: owner read/write, group read, and no access for others.

Grant a specific on-call user read access during an incident:

```bash
sudo setfacl -m u:maya:r /srv/web/config.env
```

Inspect again:

```bash
getfacl /srv/web/config.env

# Example output:
# # file: srv/web/config.env
# # owner: root
# # group: web
# user::rw-
# user:maya:r--
# group::r--
# mask::r--
# other::---
```

The `user:maya:r--` line is the new specific rule. The `mask::r--` line limits the maximum effective access for named users and groups in the ACL.

That mask is a common source of confusion. If an ACL entry says a group has `rw-` and the mask says `r--`, the effective access is read-only. When an ACL seems ignored, inspect `getfacl` before changing the file to `777`.

Grant a group read and execute access to a directory:

```bash
sudo setfacl -m g:oncall:rx /srv/web
```

On a directory, execute means members can traverse the path by name.

Default ACLs apply to new files created inside a directory:

```bash
sudo setfacl -d -m g:web:rx /srv/web/releases
```

Here `-d` sets a default ACL for future children, and `-m` modifies the ACL list. Default ACLs are useful for release directories because new files can inherit the shared access rule.

ACLs are useful, and they can hide access paths from people who only check `ls -l`. When a permission decision seems confusing, `getfacl` gives the full picture. For long-term access, a well-named group is often clearer than many one-off ACL entries.

## Sudo with Least Privilege
<!-- section-summary: `sudo` should grant the narrow admin commands a user needs rather than full root access by default. -->

The final permission problem is admin access. A deploy account often needs exactly one privileged action: restart the application after publishing a release. Giving that account a full root shell would make every file and service reachable from the deploy path, which is far more access than the job needs.

`sudo` lets an authorized user run specific commands with elevated privileges. The broad version gives full root access. Production servers usually benefit from narrower rules. The deploy user may need to restart only `app.service`, reload Nginx after validation, and inspect service status.

Sudoers rules exist because some tasks require root while the whole session should stay unprivileged. The rule matches the calling user, target user, host, and exact command path. Small path differences matter, so verify binary locations before writing the rule.

Sudoers rules belong in files under `/etc/sudoers.d/` and should be edited with `visudo`, which checks syntax before saving:

```bash
sudo visudo -f /etc/sudoers.d/app-deploy
```

A scoped rule can look like this:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart app.service, /usr/bin/systemctl status app.service, /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
```

The rule is small, but each part carries real access:

- `deploy` is the calling user. Only that account receives the privilege from this line.
- `ALL=(root)` means the rule can run on any host where the file is installed, and the target user is `root`.
- `NOPASSWD:` allows the listed commands without an interactive password prompt, which is useful for deployment automation.
- `/usr/bin/systemctl ...` and `/usr/sbin/nginx -t` are exact command paths with exact arguments. A different path or broader wildcard would grant a different permission.
- The risk is command scope. Restarting one service and testing Nginx is narrow; granting `sudo /usr/bin/systemctl *` would allow the deploy account to affect many services.

This grants the deploy user exactly those commands as root. The exact paths must match the system. Check binary paths before writing the rule:

```bash
command -v systemctl nginx

# Example output:
# /usr/bin/systemctl
# /usr/sbin/nginx
```

Verification is part of the setup:

```bash
sudo -l -U deploy

# Example output:
# User deploy may run the following commands on server01:
#     (root) NOPASSWD: /usr/bin/systemctl restart app.service, /usr/bin/systemctl status app.service, /usr/sbin/nginx -t, /usr/bin/systemctl reload nginx
```

The output should show only the commands the deployment flow needs. If it shows `(ALL : ALL) ALL`, the user has broad root access.

Sudo logs also matter. On many distributions, sudo activity appears in `/var/log/auth.log` or through the journal:

```bash
sudo journalctl _COMM=sudo --since "today"

# Example output:
# Jun 24 09:15:02 server01 sudo[2384]: deploy : TTY=pts/0 ; PWD=/srv/web ; USER=root ; COMMAND=/usr/bin/systemctl restart app.service
# Jun 24 09:15:08 server01 sudo[2401]: deploy : TTY=pts/0 ; PWD=/srv/web ; USER=root ; COMMAND=/usr/sbin/nginx -t
```

The practical goal is simple. Human users, deploy automation, service processes, and Nginx each receive only the access their job needs. That design keeps day-to-day operations smooth while limiting damage from mistakes and compromises.

If `sudo -l -U deploy` shows a broader rule than expected, the next decision is to narrow it in a separate sudoers file and test the deploy flow. If a command fails even though the rule looks right, compare `command -v` output with the path written in sudoers.

![Sudo permission gate infographic showing a deploy user passing through a narrow sudoers rule to restart one service](/content-assets/articles/article-devops-foundation-linux-linux-basics-permissions-users/sudo-permission-gate.png)

_The image makes least-privilege sudo concrete: one user, one allowed command, and a clear audit path._

![Permissions and users summary infographic showing users, groups, rwx bits, ownership, ACLs, sudo, and service accounts](/content-assets/articles/article-devops-foundation-linux-linux-basics-permissions-users/permissions-users-summary.png)

_The summary image gathers users, groups, ownership, ACLs, and sudo into one access-control map._

## References

- [Linux `chmod(1)` manual](https://man7.org/linux/man-pages/man1/chmod.1.html) - Documents symbolic and octal permission changes.
- [Linux `chown(1)` manual](https://man7.org/linux/man-pages/man1/chown.1.html) - Documents changing file owner and group.
- [Linux `useradd(8)` manual](https://man7.org/linux/man-pages/man8/useradd.8.html) - Documents creating local users.
- [Linux `groupadd(8)` manual](https://man7.org/linux/man-pages/man8/groupadd.8.html) - Documents creating local groups.
- [Linux `acl(5)` manual](https://man7.org/linux/man-pages/man5/acl.5.html) - Documents POSIX ACL behavior.
- [sudoers manual](https://www.sudo.ws/docs/man/sudoers.man/) - Official sudoers policy documentation.
- [systemd service credentials and users](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) - Documents service execution settings including user and group controls.
