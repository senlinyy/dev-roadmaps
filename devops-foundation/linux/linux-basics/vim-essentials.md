---
title: "Vim Essentials"
description: "Learn the Vim text editor from zero: modes, navigation, editing, search, and a practical workflow for editing config files on remote servers."
overview: "Navigate and edit files confidently with Vim, the terminal-based editor available on every Linux server, so you never feel stuck when SSH'd into a machine with no GUI."
tags: ["vim", "editor", "modal", "config"]
order: 2
id: article-devops-foundation-linux-linux-basics-vim-essentials
---

## Table of Contents

1. [Why Vim?](#why-vim)
2. [The Modal Model](#the-modal-model)
3. [Survival Basics: Open, Edit, Save, Quit](#survival-basics-open-edit-save-quit)
4. [Moving Around: Navigation](#moving-around-navigation)
5. [Editing: Delete, Copy, Paste, Undo](#editing-delete-copy-paste-undo)
6. [Search and Replace](#search-and-replace)
7. [Working with Multiple Files](#working-with-multiple-files)
8. [A Practical Workflow](#a-practical-workflow)
9. [Cheatsheet](#cheatsheet)

## Why Vim?

If you have been using VS Code, Sublime Text, or any other GUI editor, you might wonder why anyone would voluntarily use a terminal-based editor from the 1970s. The answer is simple: it is everywhere and sometimes it is all you have.

When you SSH into a remote server, a Docker container, or an EC2 instance to fix a broken config file, there is no GUI. There is no way to open VS Code or click around with a mouse. What you do have is a terminal, and that terminal almost certainly has Vim installed. Even the most minimal Linux distributions include it. Alpine Linux, the tiny image used in most Docker containers, ships `vi` (Vim's predecessor) by default.

You do not need to become a Vim power user. You need to be comfortable enough to open a file, make a change, save it, and get out. That baseline skill eliminates a real category of "I'm stuck on a server and can't edit anything" moments. Once you have the basics, many engineers find that Vim's keyboard-driven workflow actually becomes faster than reaching for a mouse, and some switch to it entirely. But the goal of this article is the reliable baseline, not conversion.

The command `vi` on most modern systems actually launches Vim (Vi Improved), an enhanced version of the original `vi` editor. Throughout this article, `vim` and `vi` are interchangeable for everything we cover.

## The Modal Model

Every other editor you have used works the same way: you type, and characters appear on screen. Vim is different. It has modes, and what your keys do depends on which mode you are in.

This design has a practical origin. When Bill Joy created vi in 1976, he was working on an ADM-3A terminal over a 300-baud modem: no arrow keys, no function keys, no mouse. A modal design meant every key on the keyboard could serve as a command in Normal mode without needing Ctrl or Alt combinations. That constraint produced an editing model where every action is one to three keystrokes, which is why the design survived long after the hardware limitations disappeared.

| Mode | Enter with | Return to Normal | Purpose |
|------|-----------|-----------------|---------|
| **NORMAL** | (default) | (already here) | Navigation and commands |
| **INSERT** | `i`, `a`, `o` | `Esc` | Type text normally |
| **COMMAND** | `:` | `Enter` or `Esc` | Run commands like `:w`, `:q`, `:%s` |
| **SEARCH** | `/` or `?` | `Enter` or `Esc` | Find text in file |

Normal mode is where you start when you open Vim. In this mode, every key is a command. Pressing `j` moves the cursor down, `dd` deletes a line, and `w` jumps forward one word. Nothing you type in Normal mode inserts text into the file.

Insert mode is where Vim behaves like any other editor. Press `i` to enter Insert mode, and your keystrokes become text in the file. Press `Esc` to return to Normal mode.

Command-line mode activates when you press `:` from Normal mode. A colon appears at the bottom of the screen, and you type a command like `:wq` (save and quit) or `:%s/old/new/g` (find and replace). Press `Enter` to execute or `Esc` to cancel.

If you remember nothing else, remember this: `Esc` always brings you back to Normal mode. If you are confused about what mode you are in, press `Esc` once or twice and you are back to safe ground.

## Survival Basics: Open, Edit, Save, Quit

Let's walk through the absolute minimum workflow. Open a file with `vim` followed by the filename:

```bash
$ vim /etc/hostname
```

Vim opens and you see the file contents. You are in Normal mode. The cursor sits on the first character. To make a change, press `i` to enter Insert mode. You will see `-- INSERT --` at the bottom of the screen. Now you can type normally. Make your edit, then press `Esc` to go back to Normal mode.

To save and quit, type `:wq` and press `Enter`. The `:` enters Command-line mode, `w` writes (saves) the file, and `q` quits Vim.

```text
:wq    → save and quit
:q!    → quit WITHOUT saving (discard all changes)
:w     → save but stay in Vim
:q     → quit (only works if there are no unsaved changes)
```

The `!` in `:q!` is a force flag. It tells Vim "I know I have unsaved changes and I want to throw them away." Without the `!`, Vim refuses to quit if you have unsaved work, which is actually a helpful safety net.

If you accidentally opened the wrong file or made edits you regret, `:q!` is your escape hatch. No damage done.

There is one more piece of vim's design worth knowing about before you make your first edits, because eventually you will see it on screen. When you open a file, vim does not edit the file directly. It loads the contents into an in-memory buffer and writes a hidden swap file alongside it (something like `.deploy.sh.swp`). All your edits go into the buffer, and `:w` is what actually overwrites the file on disk. The swap file exists for a single reason: crash recovery. If your SSH session drops, your laptop loses power, or vim itself crashes mid-edit, the swap file preserves your unsaved changes so you can recover them next time you open the file. The downside is that if you ever see "swap file already exists" when opening a file, vim is warning you that either another process is editing the same file, or a previous session crashed and never cleaned up. That distinction (buffer in memory, swap file on disk, real file untouched until you save) is also why `:q!` is safe: nothing you typed has touched the original file.

To create a new file, just open a name that does not exist yet:

```bash
$ vim newfile.txt
```

Vim opens an empty buffer. Edit, then `:wq` to save it. The file is created on disk at that point.

### Entering Insert Mode: More Than Just `i`

The `i` key enters Insert mode with the cursor at its current position. But there are several other ways to enter Insert mode, each placing the cursor somewhere useful:

```text
i    → insert before the cursor
a    → insert after the cursor (append)
I    → insert at the beginning of the line
A    → insert at the end of the line
o    → open a new line below and enter Insert mode
O    → open a new line above and enter Insert mode
```

The `o` and `O` keys are particularly handy. When you want to add a new line to a config file, pressing `o` in Normal mode creates the line and drops you into Insert mode in one keystroke, instead of navigating to the end of a line, pressing `Enter`, and then switching to Insert mode.

## Moving Around: Navigation

In Normal mode, Vim offers layered navigation: from single characters up to the entire file.

### Character and Line Movement

The most basic movement keys are `h`, `j`, `k`, and `l`. They move the cursor left, down, up, and right respectively. The arrow keys also work, but experienced Vim users prefer `hjkl` because your fingers never leave the home row.

The reason the keys are `hjkl` specifically (and not, say, `wasd` like a video game) is the same hardware story from earlier. The ADM-3A terminal Bill Joy used had no arrow keys at all. Look at a photograph of that keyboard and you will see arrows literally printed on the `h`, `j`, `k`, and `l` keycaps, because those were the keys you used to move the cursor in any program on that machine. Joy mapped vi's navigation to the same keys because that is what users were already trained on. The arrows on the keycap disappeared decades ago, but the convention stuck because once enough scripts, plugins, and muscle memory depend on a layout, changing it costs more than keeping it.

```text
     k
     ↑
h ←     → l
     ↓
     j
```

You do not need to memorize this immediately. Use arrow keys until muscle memory kicks in.

### Word Movement

Moving character by character is slow. Word-level movement is faster:

```text
w    → jump to the start of the next word
b    → jump back to the start of the previous word
e    → jump to the end of the current word
```

In a line like `server_name example.com;`, pressing `w` three times takes you from `server_name` to `example.com;` to the next line.

### Line-Level Movement

```text
0    → jump to the beginning of the line
$    → jump to the end of the line
^    → jump to the first non-whitespace character
```

The `^` key is especially useful in indented files like YAML or Python, where `0` would land you on whitespace but `^` lands you where the content starts.

### File-Level Movement

```text
gg   → go to the first line of the file
G    → go to the last line of the file
42G  → go to line 42 (replace 42 with any line number)
:42  → also goes to line 42 (Command-line mode)
```

When an error message says "syntax error on line 87," you type `87G` and you are there instantly. This is one of the first things in Vim that feels genuinely faster than a GUI editor, where you would need to open a "Go to Line" dialog or scroll manually.

### Screen Movement

```text
Ctrl+d    → scroll half a page down
Ctrl+u    → scroll half a page up
H         → move cursor to the top of the visible screen
M         → move cursor to the middle of the visible screen
L         → move cursor to the bottom of the visible screen
```

These are useful when reading through a long file and you want to move your viewport without losing your place.

## Editing: Delete, Copy, Paste, Undo

Vim's editing commands in Normal mode operate on text objects: characters, words, lines. Once you see the pattern, it scales to everything.

### Deleting

```text
x     → delete the character under the cursor
dd    → delete the entire current line
dw    → delete from cursor to the start of the next word
d$    → delete from cursor to end of line
D     → same as d$ (shortcut)
3dd   → delete 3 lines starting from the current one
```

The `d` key is the "delete operator." It waits for a motion to tell it how much to delete. `dw` means "delete a word," `d$` means "delete to end of line," and `dG` means "delete from here to the end of the file." Any motion you learned in the navigation section works here.

### Copying and Pasting

Vim calls copying "yanking" (the `y` key) and pasting "putting" (the `p` key):

```text
yy    → yank (copy) the entire current line
yw    → yank from cursor to start of next word
y$    → yank from cursor to end of line
3yy   → yank 3 lines
p     → put (paste) after the cursor
P     → put (paste) before the cursor
```

When you delete something with `dd` or `dw`, the deleted text is also stored, so you can paste it back with `p`. This means `ddp` swaps two adjacent lines: delete the current line, then paste it below.

### Undo and Redo

```text
u        → undo the last change
Ctrl+r   → redo (undo the undo)
```

Vim has unlimited undo history within a session. If you make a mess, just keep pressing `u` until the file looks right.

### The Dot Command

The `.` key repeats the last change you made. If you just deleted a line with `dd` and want to delete three more, press `.` three times instead of typing `dd` three more times. If you just inserted the word "server" and need it in multiple places, navigate to the next location and press `.` to insert it again.

The dot command is deceptively powerful. Once you start thinking in terms of "make one change, then repeat it," your editing speed increases significantly.

## Search and Replace

### Searching

Press `/` in Normal mode to start a forward search. Type your search term and press `Enter`. Vim jumps to the first match.

```text
/error      → search forward for "error"
?error      → search backward for "error"
```

After the initial search, you jump between matches with:

```text
n     → jump to the next match (same direction)
N     → jump to the previous match (opposite direction)
```

So the full workflow is: type `/nginx`, press `Enter` to jump to the first match, then press `n` repeatedly to cycle through all occurrences. If you overshoot, press `N` to go back one. This continues to work even after you leave search mode; pressing `n` or `N` at any time repeats the last search.

To turn off the highlighting after a search, type `:noh` (short for `:nohlsearch`) and press `Enter`.

One subtlety worth knowing: Vim's search uses regular expressions by default. Characters like `.`, `*`, `[`, and `]` have special meaning. If you want to search for a literal dot, you need to escape it: `/192\.168\.1\.1`. In practice, simple word searches work fine without worrying about regex, but keep this in mind when searching for text containing special characters.

### Search and Replace

Vim's search-and-replace uses the `:s` (substitute) command. The basic form replaces text on the current line:

```text
:s/old/new/       → replace the first "old" with "new" on the current line
:s/old/new/g      → replace ALL "old" with "new" on the current line
```

To replace across the entire file, prefix with `%` (which means "all lines"):

```text
:%s/old/new/g     → replace all "old" with "new" in the entire file
:%s/old/new/gc    → same, but ask for confirmation on each match
```

The `c` flag is extremely useful when you are not sure every occurrence should be replaced. Vim highlights each match and asks `y/n/a/q/l`:

```text
y    → yes, replace this one
n    → no, skip this one
a    → all, replace this and all remaining matches
q    → quit, stop replacing
l    → last, replace this one and stop
```

You can also restrict the replacement to a range of lines. For example, to replace only on lines 10 through 25:

```text
:10,25s/old/new/g
```

In practice, the most common patterns you will use are `:%s/old/new/g` for a confident global replace and `:%s/old/new/gc` when you want to review each substitution.

### Using `*` for Quick Word Searches

Place your cursor on any word in Normal mode and press `*`. Vim immediately searches for the next occurrence of that exact word. Press `#` to search backward for it. This is faster than typing `/the-word-you-want` when the word is already on screen. Combined with `n` and `N`, you can quickly audit every place a variable name or configuration key appears in a file.

## Working with Multiple Files

You can open multiple files at once:

```bash
$ vim file1.txt file2.txt
```

Vim loads the first file. To switch between them:

```text
:n       → next file
:prev    → previous file
:ls      → list all open files (buffers)
:b2      → switch to buffer number 2
```

You can also split the screen to view two files side by side:

```text
:split file2.txt    → horizontal split
:vsplit file2.txt   → vertical split
Ctrl+w w            → switch between splits
Ctrl+w q            → close the current split
```

Splits are particularly useful when editing a config file while referencing another. You keep the original visible in one pane and make changes in the other.

## A Practical Workflow

Let's put it all together with a real scenario: editing an Nginx configuration file on a remote server.

```bash
$ ssh user@webserver
$ sudo vim /etc/nginx/sites-available/default
```

You need to change the `server_name` from `example.com` to `myapp.io` and change the port from 80 to 8080. Here is a clean workflow:

First, search for the server name. Type `/server_name` and press `Enter`. Vim jumps to the line. If there are multiple `server` blocks, press `n` to step through matches until you find the right one.

Now position your cursor on `example.com`. Press `cw` (change word) to delete the word and enter Insert mode. Type `myapp.io` and press `Esc`.

Next, find the port. Type `/listen` and press `Enter`. You see `listen 80;`. Place your cursor on `80`, press `cw`, type `8080`, press `Esc`.

Save and quit with `:wq`.

The `cw` command (change word) is one of the most useful editing commands. It deletes from the cursor to the end of the word and drops you into Insert mode in one motion. It combines `dw` (delete word) and `i` (enter Insert mode) into a single action. Similarly, `cc` changes an entire line, and `c$` changes from the cursor to the end of the line.

After saving, test the config and reload:

```bash
$ sudo nginx -t
nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
nginx: configuration file /etc/nginx/nginx.conf test is successful
$ sudo systemctl reload nginx
```

Always test config files before reloading services. A syntax error in the config will prevent the service from starting, which is worse than the original problem you were fixing.

## Cheatsheet

### Modes

```text
i          Enter Insert mode (before cursor)
a          Enter Insert mode (after cursor)
o / O      Open new line below / above
Esc        Return to Normal mode
:          Enter Command-line mode
```

### Navigation

```text
h j k l    Left, down, up, right
w / b      Next word / previous word
0 / $      Start / end of line
^          First non-whitespace character
gg / G     Top / bottom of file
42G        Go to line 42
Ctrl+d     Half page down
Ctrl+u     Half page up
```

### Editing

```text
x          Delete character
dd         Delete line
dw         Delete word
D          Delete to end of line
yy         Yank (copy) line
yw         Yank word
p / P      Paste after / before cursor
u          Undo
Ctrl+r     Redo
.          Repeat last change
cw         Change word (delete + insert)
cc         Change entire line
c$         Change to end of line
```

### Search

```text
/pattern   Search forward
?pattern   Search backward
n / N      Next / previous match
*          Search word under cursor (forward)
#          Search word under cursor (backward)
:noh       Clear search highlighting
```

### Search and Replace

```text
:s/a/b/          Replace first on current line
:s/a/b/g         Replace all on current line
:%s/a/b/g        Replace all in entire file
:%s/a/b/gc       Replace all with confirmation
:10,25s/a/b/g    Replace all in line range
```

### Files and Splits

```text
:w         Save
:q         Quit (fails if unsaved changes)
:wq        Save and quit
:q!        Quit without saving
:e file    Open another file
:split     Horizontal split
:vsplit    Vertical split
Ctrl+w w   Switch between splits
Ctrl+w q   Close split
:n / :prev Next / previous file
```

### Numbers with Commands

```text
5j         Move 5 lines down
3dd        Delete 3 lines
4yy        Yank 4 lines
2dw        Delete 2 words
```

---

**References**

- [Vim Documentation](https://www.vim.org/docs.php) - The official Vim documentation covering all commands, options, and scripting.
- [Vimtutor](https://vimschool.netlify.app/introduction/vimtutor/) - The built-in interactive Vim tutorial, accessible by typing `vimtutor` in any terminal with Vim installed.
- [Vim Adventures](https://vim-adventures.com/) - A game-based approach to learning Vim navigation commands through puzzle levels.
- [Practical Vim by Drew Neil](https://pragprog.com/titles/dnvim2/practical-vim-second-edition/) - A recipe-style book covering efficient editing patterns and the composability of Vim commands.
