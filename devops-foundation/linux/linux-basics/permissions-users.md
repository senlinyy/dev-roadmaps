---
title: "Permissions & Users"
description: "Manage file permissions, ownership, user accounts, and groups to control access on Linux systems."
overview: "Use Linux users, groups, permissions, ACLs, and sudo rules to run services without giving every person or process full control."
tags: ["permissions", "users", "chmod", "sudo"]
order: 5
id: article-devops-foundation-linux-linux-basics-permissions-users
---

## Table of Contents

1. [How Does Linux Decide Which Process May Access an Object?](#how-does-linux-decide-which-process-may-access-an-object)
2. [How Do UIDs and GIDs Represent Users and Groups?](#how-do-uids-and-gids-represent-users-and-groups)
3. [How Do You Read Ownership and Modes from a Listing?](#how-do-you-read-ownership-and-modes-from-a-listing)
4. [What Do rwx Permissions Mean for Files and Directories?](#what-do-rwx-permissions-mean-for-files-and-directories)
5. [How Do chmod, Ownership, and umask Shape Access?](#how-do-chmod-ownership-and-umask-shape-access)
6. [How Should Service and Deploy Users Share Files?](#how-should-service-and-deploy-users-share-files)
7. [When Do ACLs and Special Bits Extend Basic Permissions?](#when-do-acls-and-special-bits-extend-basic-permissions)
8. [How Does sudo Grant Least Privilege and How Do You Debug Denials?](#how-does-sudo-grant-least-privilege-and-how-do-you-debug-denials)
9. [Check Your Answers](#check-your-answers)

The first permission problem many beginners hit is painfully ordinary. You SSH into a server as `deploy`, try to copy a release into `/srv/web`, and Linux replies with `Permission denied`. The directory exists. The command looks right. The missing piece is who Linux thinks you are allowed to be in that directory.

Linux answers access questions by asking who is doing the work first. That "who" may be a human SSH account such as `deploy`, a service account such as `app`, or the root account during administration. A **user** is the account behind a running process or a file owner.

Some work needs to be shared. The deploy account and the application service may both need access to the same release directory. A **group** gives several accounts one shared identity for file access.

Every file and directory records an owning user and an owning group. That is **ownership**. The final piece is the permission bits that say what the owner, group, and everyone else may do: read, write, or execute.

Keep these questions in view as you work through the lesson:

1. **How Does Linux Decide Which Process May Access an Object?**
2. **How Do UIDs and GIDs Represent Users and Groups?**
3. **How Do You Read Ownership and Modes from a Listing?**
4. **What Do `rwx` Permissions Mean for Files and Directories?**
5. **How Do `chmod`, Ownership, and `umask` Shape Access?**
6. **How Should Service and Deploy Users Share Files?**
7. **When Do ACLs and Special Bits Extend Basic Permissions?**
8. **How Does `sudo` Grant Least Privilege and How Do You Debug Denials?**

## How Does Linux Decide Which Process May Access an Object?
<!-- section-summary: Users, groups, ownership, and permission bits decide which humans and processes can read, change, or execute files. -->

The ownership model matters on any shared Linux server. Engineers may connect over SSH. A `deploy` user may place new releases under `/srv/web`. An `app` service user may run the application. Nginx may read its own config and logs. Root can change almost anything, so normal work should use narrower accounts whenever possible.

The goal is to give each job enough access to do its work. The application process should read its own code and config while staying unable to rewrite Nginx config. The deploy user should publish a release and restart the service through approved commands. Private keys should be readable only by the account that owns them.

## How Do UIDs and GIDs Represent Users and Groups?
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

## How Do You Read Ownership and Modes from a Listing?
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

## What Do `rwx` Permissions Mean for Files and Directories?
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

The kernel selects one basic permission class rather than combining all three. If a process's effective UID matches the file owner, Linux uses the owner bits. Otherwise, if any effective or supplementary GID matches the file group, it uses the group bits. Only when neither identity matches does it use the other bits. A user who owns a file does not fall through to more generous group or other permissions.

`other` therefore means processes that matched neither the owning user nor the owning group; it does not mean unauthenticated Internet traffic. A web request is ultimately handled by a local process identity such as `www-data`. The filesystem evaluates that process's UID and groups.

Directory permissions deserve their own model because a directory stores name mappings:

| Directory bits | What the process can do |
|---|---|
| `r--` | Read directory entries, but usually not resolve their metadata without traversal |
| `--x` | Traverse known names without listing the directory |
| `r-x` | List names and traverse to reachable children |
| `-wx` | Create, rename, and remove names when other rules allow it, without necessarily listing all names |

Reaching `/srv/web/releases/app/config.yml` requires execute, or search, permission on every directory component: `/`, `/srv`, `/srv/web`, `/srv/web/releases`, and `/srv/web/releases/app`. Read permission on `config.yml` cannot compensate for a blocked parent. This is why `ls -l` on the final file is not enough during a denial.

File write permission and directory write permission also answer different questions. File `w` allows changing existing file contents. Directory `w` with `x` allows changing the names in that directory, including creating, renaming, or deleting entries. A user may be unable to edit bytes in a file yet still be able to delete its name from a writable directory. Editors that save by creating a temporary file and renaming it can require directory access even when a simple in-place write would not.

Symbolic-link permissions usually do not grant access to the target. Linux follows the link and checks the target path and its parent directories. Inspect the link with `readlink`, then check the resolved object and every directory along the path.

## How Do `chmod`, Ownership, and `umask` Shape Access?
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

### How Do Ownership Changes Differ from Mode Changes?
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

Ownership for a new file normally comes from the creating process: its effective UID becomes the owner, and its effective GID or the parent directory's setgid rule determines the group. The initial permission bits come from the program's requested mode after the process **umask** removes selected bits.

```text
regular file request:  666
umask:                 027
result:                640

directory request:     777
umask:                 027
result:                750
```

A umask is a mask of permissions to remove, not the final mode to assign. Ordinary programs usually request `666` for files because newly created data should not become executable simply because the umask allows `x`. Directories request execute bits because traversal is necessary to use their contents.

```bash
umask

# Example output:
# 0027
```

The shell, service manager, container runtime, or application can set a different umask. If a group-shared directory has setgid but new files still lack group write, inspect the creating process's umask rather than adding `777`. A cooperative team directory often combines setgid with a group-friendly umask such as `0002`; a service-secret directory commonly uses something narrower such as `0027` or `0077`.

Recursive mode changes are especially risky because files and directories need different execute semantics. `chmod -R 777` makes every object writable and may mark data files executable. When a tree needs repair, use `find` to select object types separately:

```bash
sudo find /srv/web/releases -type d -exec chmod 2775 {} +
sudo find /srv/web/releases -type f -exec chmod 0664 {} +
```

Even these commands require inspection first. They overwrite intentional exceptions such as private secrets or executable scripts. A good repair starts by identifying who should write each part of the tree, then changes only the ownership and modes that contradict that design.

## How Should Service and Deploy Users Share Files?
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

Separate the application tree by responsibility. Release code should normally be written by the deploy identity and read or executed by the service. Configuration may be owned by root and readable by the service group. Mutable data, sockets, caches, and uploads need a directory the service can write. Secrets should be readable by the fewest identities possible. Making the service own its executable code lets a compromised process replace what will run after restart, so writable runtime data and immutable release artifacts should not share one broad ownership rule.

Group membership is process state. Adding `deploy` to `web` changes the account database, but an existing shell keeps the supplementary groups it received at login. Start a new login session or use a controlled `newgrp` test before concluding that the membership change failed. `id` shows the groups of the current process context.

Numeric IDs explain why ownership can look surprising across containers and network filesystems. An inode stores numbers, not names. If UID `1001` means `deploy` on one host and another account in a container, the same mounted file may display different names while the kernel still compares the number. Align identity mappings or use an explicit ownership strategy rather than repeatedly changing files by visible name.

## When Do ACLs and Special Bits Extend Basic Permissions?
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

Three special mode bits extend the basic model:

- **setgid on a directory** makes new children inherit the directory's group, which supports shared project trees.
- **sticky on a directory** allows a broadly writable directory while restricting deletion and rename of entries to the file owner, directory owner, or a privileged process. `/tmp` commonly uses mode `1777` for this reason.
- **setuid on an executable** can make the process use the file owner's effective UID while that program runs. This is a narrow privileged-program mechanism, not a general way to make scripts work as root.

```bash
ls -ld /tmp /srv/web/releases

# Example output:
# drwxrwxrwt 18 root   root 4096 Aug 25 11:00 /tmp
# drwxrws---  8 deploy web  4096 Aug 25 10:40 /srv/web/releases
```

The final character `t` shows sticky plus execute for others. The group-position `s` shows setgid plus group execute. Uppercase `T` or `S` means the special bit is present while the corresponding execute bit is absent, a combination that often signals a mistaken mode.

## How Does `sudo` Grant Least Privilege and How Do You Debug Denials?
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

Shell redirection is a common privilege trap. In this command, `sudo` elevates `echo`, but the current unprivileged shell tries to open the destination before `echo` runs:

```bash
sudo echo 'setting=value' > /etc/example.conf

# Typical result:
# bash: /etc/example.conf: Permission denied
```

Use a privileged program that owns the write, such as `tee`, or edit through a validated administrative workflow:

```bash
printf '%s\n' 'setting=value' | sudo tee /etc/example.conf >/dev/null
```

Be careful when calling a command “limited.” Permission to run an editor, shell, interpreter, package manager, or service manager with unconstrained arguments may provide an indirect route to arbitrary root execution. Review what the permitted program can load, overwrite, execute, or delegate, not only its friendly command name.

Linux capabilities split some traditional root powers into smaller privileges. A process may receive a capability such as `CAP_NET_BIND_SERVICE` so it can bind a low-numbered port without running with UID `0`. Capabilities can reduce privilege, but they are still authority and should be inspected with the same care as sudo rules:

```bash
getcap /usr/bin/example-server
getpcaps 1842
```

When access fails, trace the decision from identity to pathname instead of changing modes blindly:

```bash
id
namei -l /srv/web/releases/current/config.env
getfacl /srv/web/releases/current/config.env
sudo -l
```

`id` shows the current process identity and supplementary groups. `namei -l` expands every pathname component and lists the owner and mode at each step, making a missing directory execute bit visible. `getfacl` reveals named entries, defaults, and the ACL mask. `sudo -l` shows the commands the current user may elevate.

Then ask four separate questions:

1. Does the process have the UID and groups you expected, or was group membership added after this session began?
2. Can it traverse every parent directory and perform the requested operation on the final object?
3. Do ACLs, mount options, immutable attributes, SELinux, AppArmor, capabilities, a read-only filesystem, or a container mapping add another control?
4. Is the application itself rejecting access after the kernel already allowed the file operation?

Traditional mode bits are one authorization layer. Authentication establishes an identity; authorization decides what that identity may do. Application policy, mandatory access controls, read-only mounts, and service sandboxes can deny an operation even when `ls -l` looks permissive. The safe response is to identify the rejecting layer, not make the service root or recursively hand it ownership of unrelated files.

### How Does a Complete Access Check Work?

Suppose `app` must read `/srv/web/shared/config.env`. The final file looks correct:

```bash
ls -l /srv/web/shared/config.env

# Example output:
# -rw-r----- 1 root web 420 Aug 25 12:00 /srv/web/shared/config.env
```

The file grants group read, and `id app` includes `web`. That proves only the final object. Expand the full path:

```bash
namei -l /srv/web/shared/config.env

# Example output:
# f: /srv/web/shared/config.env
# drwxr-xr-x root root /
# drwxr-xr-x root root srv
# drwxr-s--- deploy web web
# drwxr----- deploy web shared
# -rw-r----- root web config.env
```

The `shared` directory lacks group execute. The service cannot traverse through it even though the file is group-readable. The narrow repair is to add group traversal to that directory after confirming that members should know and reach named children:

```bash
sudo chmod g+x /srv/web/shared
sudo -u app -- test -r /srv/web/shared/config.env
```

Running the verification as the service identity matters. Root's successful `cat` proves only root access. `sudo -u app -- ...` executes the check with the identity that must work in production.

Now consider a shared release directory. The desired ownership model is:

```text
deploy user       writes versioned releases
web group         traverses and reads releases
app service       runs code as a web-group member
root              owns protected configuration and service definitions
app service       writes only /var/lib/app and /var/log/app
```

Create those boundaries explicitly:

```bash
sudo install -d -o deploy -g web -m 2775 /srv/web/releases
sudo install -d -o root   -g web -m 0750 /srv/web/config
sudo install -d -o app    -g app -m 0750 /var/lib/app
sudo install -d -o app    -g app -m 0750 /var/log/app
```

The service can read release code through `web`, but it cannot replace the release directories if the group write bit is removed from completed releases. Root-controlled config stays separate from mutable service data. A deploy can use a temporary writable directory, validate it, then publish it with final read-and-execute permissions.

Secrets need a still narrower design. A database credential might be owned by `root:web` with mode `0640` when every `web` member is trusted to read it, or by `root:app` when only the application group should. The file's parent directories must allow traversal to that identity without making the directory contents broadly listable. Do not solve a service read error by adding the deploy user, Nginx, and every operator to one oversized secret-reading group.

Deletion demonstrates why ownership alone is not enough. If `deploy` owns a release file inside a directory writable by `app`, the application can remove or rename the name even when it cannot write the file contents. Protect immutable release directories from the runtime identity. Conversely, a service that must rotate its own data needs directory write and execute on the exact mutable directory, not ownership of the whole application tree.

### Which Commands Give the Most Useful Evidence?

Use identity commands before mutation:

```bash
whoami
id
id app
getent passwd app
getent group web
```

Use path and object commands next:

```bash
ls -ld /srv /srv/web /srv/web/releases
ls -l /srv/web/releases/current/config.env
stat /srv/web/releases/current/config.env
namei -l /srv/web/releases/current/config.env
getfacl -p /srv/web/releases/current/config.env
```

`stat` shows numeric and named ownership, mode, timestamps, inode, and object type without depending on a directory listing format. `getent` consults the system's configured identity sources, so it works with local files and supported directory services rather than assuming every account is written directly in `/etc/passwd`.

Test the exact operation as the exact identity:

```bash
sudo -u app -- test -r /srv/web/config/config.env
sudo -u app -- test -x /srv/web/current/bin/server
sudo -u deploy -- test -w /srv/web/releases
```

A successful `test` produces no output and returns `0`; failure returns nonzero. This makes the checks useful in runbooks and deployment validation.

If a normal permission check passes while the operation still fails, inspect the other enforcement layers rather than widening the mode:

```bash
findmnt -no TARGET,OPTIONS /srv/web
lsattr /srv/web/config/config.env
getenforce 2>/dev/null || true
systemctl show app.service -p User -p Group -p SupplementaryGroups -p ProtectSystem -p ReadWritePaths
```

A read-only mount, immutable attribute, SELinux rule, AppArmor profile, or systemd filesystem sandbox can correctly deny the process. Each control has its own reason and repair path. Changing `chmod` cannot override a read-only mount, and making the service root does not necessarily bypass a service-manager sandbox.

Finally, remember that root is powerful without being a magical explanation for every result. Namespaces, mandatory access controls, read-only mounts, capabilities, and service sandboxing can constrain a process with UID `0`. The production goal is not to defeat those layers; it is to align them with the intended communication and ownership model.

Effective identity is the identity the kernel normally uses for an access check. A process also has real and saved IDs, which allow carefully designed privileged programs to enter and leave a narrower identity. Most ordinary commands have the same real and effective UID, but a setuid program can differ. Inspect the process instead of assuming that the login name tells the whole story:

```bash
ps -o pid,user,group,euser,egroup,comm -p 1842

# Example output:
#   PID USER GROUP EUSER EGROUP COMMAND
#  1842 app  app   app   web    web-server
```

Here the process started as `app` and uses `web` as its effective group for the operation. Supplementary groups can also participate. The kernel does not combine the owner, group, and other permission triplets. It selects the owner class when the effective UID matches the file owner; otherwise it selects the group class when an effective or supplementary GID matches; otherwise it selects other. A restrictive owner entry is therefore not supplemented by a more permissive group entry.

That selection rule explains a surprising case. If `maya` owns a file with mode `0400`, while the file's group has mode `070`, Maya receives owner permissions only. Membership in the group does not add group write or execute. ACL evaluation has more entries and a mask, but it preserves the same principle: determine the matching class, then apply the permissions available inside that class.

Group changes are also session changes. Adding `app` to `web` updates the account database, but an already-running service retains the supplementary group list it received at process creation. Restart the service or start a new login session, then verify the new process with `id`, `ps`, or `/proc/PID/status`. Repeatedly changing file modes cannot make an old process learn a new group.

Default ACLs deserve the same creation-time interpretation as `umask`. They do not retroactively rewrite existing children. When a shared directory has a default ACL, newly created files derive access from that default and the creating program's requested mode. The ACL mask limits effective named-user and group permissions:

```bash
sudo setfacl -m d:u::rwx,d:g::rwx,d:g:web:rwx,d:m::rwx,d:o::--- /srv/web/releases
sudo -u deploy -- touch /srv/web/releases/next-build
getfacl /srv/web/releases/next-build
```

If older files still lack the rule, inspect and update them deliberately rather than assuming the default covered them. If `getfacl` prints `#effective:r--` beside an entry that appears to grant `rw-`, the mask is the active limit. Widen the mask only when every entry governed by it may receive the wider access.

A permission incident can therefore follow a fixed evidence order:

1. Name the failed operation precisely: read file data, create a name, replace a file, traverse a directory, execute a program, or bind a privileged port.
2. Identify the actual process and effective identities with `ps`, `id`, the service unit, and `/proc/PID/status`.
3. Resolve symlinks and inspect every pathname component with `readlink -f` and `namei -l`.
4. Inspect mode, owner, numeric IDs, ACLs, and special bits with `stat` and `getfacl`.
5. Reproduce the exact operation as the service identity with `sudo -u`, not as root.
6. Inspect mount flags, immutable attributes, mandatory access control, container ID mappings, and service sandboxing.
7. Change the narrowest layer that contradicts the intended ownership model, then repeat the identity-specific test.

Consider a deployment that fails while replacing `/srv/web/current`. The symlink itself may be owned by `deploy`, but replacement is an operation on the parent directory. The deploy process needs write and execute on `/srv/web`; it does not need write access to the old release contents. If `/srv/web` is intentionally root-owned and non-writable, publish through a narrow privileged command rather than transferring ownership of the entire tree.

The reverse distinction appears during editing. Many editors save by writing a temporary file and renaming it over the original. That workflow needs directory write and execute even when the user can write the original file directly. An editor failure does not prove the file's write bit is wrong. Observe whether the program opens the inode in place or performs a create-and-rename sequence.

Numeric identities become especially visible across containers and network filesystems. A host file owned by UID `1001` remains owned by the number; a container that maps `1001` to a different name sees different text for the same identity. NFS may apply server-side identity mapping or root squashing. Compare `stat -c '%u:%g %a %n'` on both sides before using `chown`, because changing a name-based mapping does not change the stored numbers.

Least privilege also requires reasoning about indirect effects. A sudo rule for `systemctl restart app.service` may look narrow, but it becomes broad if the deploy user can replace the unit file, its executable, or an environment file loaded by the service. A rule for an editor, shell, archive extractor, or interpreter is effectively a route to whatever that program can execute or overwrite. Protect every input consumed by the privileged operation, and let the unprivileged user write only versioned release data that a controlled publish step validates.

A practical permission design can be reviewed as a writer matrix:

| Path | Owner and group | Expected writer | Expected reader |
|---|---|---|---|
| `/srv/web/releases` | `deploy:web` | deployment process | application and operators |
| `/srv/web/current` parent | protected publish owner | narrow publish command | application |
| `/etc/web` | `root:app` | administrators | application |
| `/var/lib/web` | `app:app` | application | application |
| `/var/log/web` | `app:adm` | application | application and log operators |

For each path, ask who creates names, who changes content, who only reads, and whether inheritance keeps new objects consistent. This turns modes from isolated numbers into an ownership model. `0750`, `0640`, an ACL, or a sudo rule is correct only when it implements that model and remains understandable to the next operator.

The deepest rule is to begin with the process and requested operation. Names, mode digits, ACL entries, capabilities, and sudo rules are mechanisms for that decision. A correct fix makes the intended writer and reader explicit, leaves unrelated identities denied, and can be verified by performing the exact operation as the exact service identity.

That verification should include creation as well as access when inheritance matters. Create a disposable file as the deploy or service account, inspect its numeric owner, group, mode, ACL, and parent setgid behavior, then remove it through the same identity. Reading one existing file cannot prove that tomorrow's release or rotated log will inherit the intended model.

![Sudo permission gate infographic showing a deploy user passing through a narrow sudoers rule to restart one service](/content-assets/articles/article-devops-foundation-linux-linux-basics-permissions-users/sudo-permission-gate.png)

_The image makes least-privilege sudo concrete: one user, one allowed command, and a clear audit path._

![Permissions and users summary infographic showing users, groups, rwx bits, ownership, ACLs, sudo, and service accounts](/content-assets/articles/article-devops-foundation-linux-linux-basics-permissions-users/permissions-users-summary.png)

_The summary image gathers users, groups, ownership, ACLs, and sudo into one access-control map._

## Check Your Answers

:::expand[How Does Linux Decide Which Process May Access an Object?]{kind="recap"}
The kernel evaluates a running process's effective identities against ownership, permissions, ACLs, and additional security layers.
:::

:::expand[How Do UIDs and GIDs Represent Users and Groups?]{kind="recap"}
Names are human labels; processes and filesystem objects carry numeric user and group identities that must map consistently.
:::

:::expand[How Do You Read Ownership and Modes from a Listing?]{kind="recap"}
A long listing exposes object type, owner, group, mode, link count, size, time, and name as initial evidence.
:::

:::expand[What Do `rwx` Permissions Mean for Files and Directories?]{kind="recap"}
File bits control content access and execution, while directory bits control listing, traversal, and modification of names.
:::

:::expand[How Do `chmod`, Ownership, and `umask` Shape Access?]{kind="recap"}
Modes define allowed operations, ownership selects the applicable class, and umask removes permissions during object creation.
:::

:::expand[How Should Service and Deploy Users Share Files?]{kind="recap"}
Separate deploy authority, runtime identity, immutable code, protected configuration, secrets, and service-writable data by responsibility.
:::

:::expand[When Do ACLs and Special Bits Extend Basic Permissions?]{kind="recap"}
ACLs add named exceptions and inheritance, while setgid, sticky, and setuid alter group inheritance, deletion, or execution identity.
:::

:::expand[How Does `sudo` Grant Least Privilege and How Do You Debug Denials?]{kind="recap"}
Grant exact privileged actions, then trace denials through identity, every path component, ACLs, capabilities, and application policy.
:::

### References

- [Linux `chmod(1)` manual](https://man7.org/linux/man-pages/man1/chmod.1.html) - Documents symbolic and octal permission changes.
- [Linux `chown(1)` manual](https://man7.org/linux/man-pages/man1/chown.1.html) - Documents changing file owner and group.
- [Linux `useradd(8)` manual](https://man7.org/linux/man-pages/man8/useradd.8.html) - Documents creating local users.
- [Linux `groupadd(8)` manual](https://man7.org/linux/man-pages/man8/groupadd.8.html) - Documents creating local groups.
- [Linux `acl(5)` manual](https://man7.org/linux/man-pages/man5/acl.5.html) - Documents POSIX ACL behavior.
- [sudoers manual](https://www.sudo.ws/docs/man/sudoers.man/) - Official sudoers policy documentation.
- [systemd service credentials and users](https://www.freedesktop.org/software/systemd/man/latest/systemd.exec.html) - Documents service execution settings including user and group controls.
