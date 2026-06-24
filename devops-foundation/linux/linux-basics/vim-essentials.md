---
title: "Vim Essentials"
description: "Learn the Vim text editor from zero: modes, navigation, editing, search, and a practical workflow for editing config files on remote servers."
overview: "Learn enough Vim to safely edit Nginx, systemd, and application config files while connected to a Linux server over SSH."
tags: ["vim", "editor", "modal", "config"]
order: 2
id: article-devops-foundation-linux-linux-basics-vim-essentials
---

## Table of Contents

1. [Why Vim Matters on a Server](#why-vim-matters-on-a-server)
2. [Modes: How Vim Changes What Keys Do](#modes-how-vim-changes-what-keys-do)
3. [Open, Edit, Save, and Quit](#open-edit-save-and-quit)
4. [Move Through a Config File](#move-through-a-config-file)
5. [Change Text Without Losing Control](#change-text-without-losing-control)
6. [Search, Replace, and Review](#search-replace-and-review)
7. [A Safe Remote Editing Workflow](#a-safe-remote-editing-workflow)
8. [Cheatsheet](#cheatsheet)
9. [References](#references)

## Why Vim Matters on a Server
<!-- section-summary: Vim is the editor you can rely on when a remote Linux server only gives you a terminal. -->

When you SSH into `api-01`, the Linux VM running our `inventory-api`, you may only have a terminal. There is no desktop editor, and a broken Nginx config may need a fix before you can spend time setting up a remote IDE. Vim matters because it is usually available on servers, rescue shells, containers, and cloud images.

Operating Linux requires only a practical Vim baseline: open a file, move to the right line, make a small change, save, quit, and recover when you press the wrong key. That baseline keeps a simple Nginx change from turning into a stressful moment.

The running scenario is a common one. The API process listens on `127.0.0.1:3000`, and Nginx proxies public requests to it. The site config lives at `/etc/nginx/sites-available/inventory-api.conf`. When the backend port changes, someone has to edit that file correctly, test the Nginx config, and reload the service.

## Modes: How Vim Changes What Keys Do
<!-- section-summary: Vim uses modes so the same keys can either edit text or run commands, depending on the current state. -->

Vim is a **modal editor**. A mode is a state that changes what your keys mean. In one mode, typing `server_name` writes those letters into the file. In another mode, pressing `w` jumps to the next word and pressing `dd` deletes a line.

The main modes for beginner server work are:

| Mode | Enter with | Leave with | What it is for |
|---|---|---|---|
| **Normal** | Vim starts here | Already here | Moving, deleting, copying, searching, and running commands |
| **Insert** | `i`, `a`, `o`, `O` | `Esc` | Typing normal text into the file |
| **Command-line** | `:` | `Enter` or `Esc` | Saving, quitting, replacing text, opening files |
| **Search** | `/` or `?` | `Enter` or `Esc` | Finding text forward or backward |

Normal mode is the home base. When you feel lost, pressing `Esc` once or twice returns you there. That habit matters because most useful Vim actions start from Normal mode.

Here is how this plays out during a real edit. You open the Nginx site file and start in Normal mode. You search for `proxy_pass`, enter Insert mode to change the port, press `Esc` to return to Normal mode, then run `:wq` to write and quit.

## Open, Edit, Save, and Quit
<!-- section-summary: The survival workflow is open a file, enter Insert mode, save with `:w`, and quit with `:q`. -->

Opening a file is just `vim` followed by the path. System config files usually require elevated privileges, so the Nginx site file uses `sudo`.

```bash
$ sudo vim /etc/nginx/sites-available/inventory-api.conf
```

Vim opens in Normal mode. The smallest edit flow looks like this:

1. Press `i` to enter Insert mode.
2. Type or change the text.
3. Press `Esc` to return to Normal mode.
4. Type `:wq` and press `Enter` to save and quit.

The commands below are the ones that keep you safe during the first month of Vim:

| Command | Meaning | Production use |
|---|---|---|
| `:w` | Write the file to disk | Save after a small correct edit |
| `:q` | Quit | Leave a file with no unsaved changes |
| `:wq` | Write and quit | Save a finished config edit |
| `:q!` | Quit and discard buffer changes | Escape after editing the wrong file |
| `:e!` | Reload the file from disk and discard buffer changes | Start over while staying in Vim |

Vim edits a buffer in memory first. The file on disk changes only when you write it with `:w`. Vim also creates a swap file during editing so it can recover unsaved work after a crashed terminal session. When Vim warns about an existing swap file, pause and decide whether another person is editing the file or an old SSH session died.

For the Nginx port change, the actual edit may be tiny:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

If the API moves to port `3100`, Insert mode lets you change only that number. The rest of the workflow happens outside Vim: test the config with `sudo nginx -t`, then reload Nginx if the test passes.

## Move Through a Config File
<!-- section-summary: Normal-mode navigation lets you reach the right line quickly without scrolling through a terminal by hand. -->

Server config files can be short, but real Nginx and systemd files still grow. Normal-mode movement lets you reach the right location without treating the terminal like a slow text box.

The basic cursor keys are `h`, `j`, `k`, and `l` for left, down, up, and right. Arrow keys also work on most systems. The reason many engineers still use `hjkl` is speed and muscle memory, especially over remote sessions where terminal behavior may vary.

Word and line movement matter more than character movement:

| Key | Movement |
|---|---|
| `w` | Next word |
| `b` | Previous word |
| `0` | Beginning of the line |
| `^` | First non-space character on the line |
| `$` | End of the line |
| `gg` | First line of the file |
| `G` | Last line of the file |
| `42G` | Line 42 |

This helps when Nginx reports an error with a line number:

```bash
$ sudo nginx -t
nginx: [emerg] invalid URL prefix in /etc/nginx/sites-enabled/inventory-api.conf:18
nginx: configuration file /etc/nginx/nginx.conf test failed
```

Back in Vim, `18G` takes you directly to line 18. The command `:set number` shows line numbers, and `:set relativenumber` can help when you need to move a known number of lines. Many operators turn on line numbers during config repair because service error messages usually speak in line numbers.

## Change Text Without Losing Control
<!-- section-summary: Vim editing commands combine an action with a movement, which makes small config changes fast and repeatable. -->

Insert mode is enough for basic edits, but Normal mode gives you precise changes with fewer keystrokes. Vim often combines an operator with a motion. The operator says what to do, and the motion says how much text it affects.

Common delete and change commands are:

| Command | Meaning | Example use |
|---|---|---|
| `x` | Delete one character | Remove an extra `;` |
| `dd` | Delete the current line | Remove a duplicate directive |
| `D` | Delete from cursor to end of line | Clear a wrong value |
| `cw` | Change from cursor through the word | Replace `localhost` with `127.0.0.1` |
| `ci"` | Change inside quotes | Replace a quoted path |
| `u` | Undo | Reverse the last edit |
| `Ctrl+r` | Redo | Reapply an undone edit |

Copy and paste use Vim's older words, **yank** and **put**. `yy` yanks the current line, `p` puts it below the cursor, and `P` puts it above. When you need a second `location` block in Nginx, `yy` and `p` can duplicate the nearby block before you edit the path.

The dot command, `.`, repeats the last change. For example, if you use `cw3100` then `Esc` to change one port value, pressing `.` on another matching value repeats the same change. That is useful when a config file has the same backend port in a main server block and a health-check block.

## Search, Replace, and Review
<!-- section-summary: Search and substitution help you find every related directive before you save a server config change. -->

Search starts from Normal mode. `/proxy_pass` searches forward for the next `proxy_pass`, and `?proxy_pass` searches backward. After a search, `n` jumps to the next match and `N` jumps to the previous match.

This is the natural way to review every reference to the API backend:

```vim
/proxy_pass
n
n
```

Search also helps with config includes. Nginx files often include other files, and the active setting may live outside the file you opened first. Searching for `include`, `server_name`, and `location` gives you a quick map of the file before you edit.

Substitution changes text by pattern. The form is `:%s/old/new/g`, where `%` means the whole file and `g` means every match on each line.

```vim
:%s/127.0.0.1:3000/127.0.0.1:3100/g
```

For production config, confirmation is safer:

```vim
:%s/127.0.0.1:3000/127.0.0.1:3100/gc
```

The final `c` asks before each replacement. That matters when the same text appears in a comment, a backup block, or an example line that should stay unchanged.

Before leaving Vim, a quick review reduces mistakes. `:set number` shows line numbers, `/` jumps through changed directives, and `:w` writes the file. Then the shell takes over with the official service validation command.

## A Safe Remote Editing Workflow
<!-- section-summary: Safe server edits include backup, minimal change, validation, reload, and rollback path. -->

Editing production files directly requires a small ritual. The ritual protects you from typos and gives you a way back if the service rejects the change.

For the Nginx site file, the workflow can look like this:

```bash
$ sudo cp /etc/nginx/sites-available/inventory-api.conf \
  /etc/nginx/sites-available/inventory-api.conf.bak.$(date +%Y%m%d-%H%M%S)

$ sudo vim /etc/nginx/sites-available/inventory-api.conf

$ sudo nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful

$ sudo systemctl reload nginx
```

The backup copy is simple and boring, which is exactly what you want at 02:00. The Vim edit stays small. `nginx -t` validates syntax before the live service reloads. `systemctl reload nginx` asks Nginx to reload config without dropping existing connections.

If validation fails, Vim can reopen the file and fix the line. If the reload causes a real problem, the backup is ready:

```bash
$ sudo cp /etc/nginx/sites-available/inventory-api.conf.bak.20260624-091500 \
  /etc/nginx/sites-available/inventory-api.conf
$ sudo nginx -t
$ sudo systemctl reload nginx
```

The same shape applies to systemd units and environment files. Back up the file, make the smallest edit, run the service's validation command when one exists, reload or restart intentionally, and keep the rollback command obvious.

## Cheatsheet
<!-- section-summary: A compact set of Vim commands covers most remote Linux editing tasks. -->

| Task | Keys or command |
|---|---|
| Enter Insert mode before cursor | `i` |
| Enter Insert mode after cursor | `a` |
| Open a new line below | `o` |
| Return to Normal mode | `Esc` |
| Save | `:w` |
| Save and quit | `:wq` |
| Quit and discard changes | `:q!` |
| Search forward | `/pattern` |
| Next search result | `n` |
| Go to line 42 | `42G` or `:42` |
| Delete current line | `dd` |
| Copy current line | `yy` |
| Paste below | `p` |
| Undo | `u` |
| Replace with confirmation | `:%s/old/new/gc` |

This is enough to edit `/etc/nginx`, `/etc/systemd/system`, `/etc/fstab`, and simple environment files during normal server work. More Vim can come later, after the basics are steady.

## References

- [Vim user manual table of contents](https://vimhelp.org/usr_toc.txt.html) - Official Vim help index for beginner and advanced topics.
- [Vim editing effectively](https://vimhelp.org/usr_02.txt.html) - Official Vim tutorial section covering basic editing.
- [Vim moving around](https://vimhelp.org/usr_03.txt.html) - Official Vim tutorial section covering navigation.
- [Nginx command-line parameters](https://nginx.org/en/docs/switches.html) - Documents `nginx -t` and reload-related command options.
- [systemctl manual](https://www.freedesktop.org/software/systemd/man/latest/systemctl.html) - Documents `reload`, `restart`, and service control commands.
