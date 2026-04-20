---
title: "Search and Replace"
sectionSlug: search-and-replace
order: 4
---

Search and replace is one of the most powerful editing tools in Vim. Practice on a YAML deployment config.

A Kubernetes deployment is at `/home/dev/deployment.yml`. Open it with `vim /home/dev/deployment.yml` and try:

1. **Search** for `staging` by typing `/staging` and pressing Enter. Press `n` to jump to the next match and `N` to go back.
2. **Replace one occurrence** - on the current line, use `:s/staging/production/` to replace the first match.
3. **Replace all in the file** - use `:%s/staging/production/g` to change every `staging` to `production` at once.
4. **Undo everything** with repeated `u` to restore the original file.
5. **Try `*`** - place your cursor on the word `nginx` and press `*` to jump to the next occurrence of that exact word.

You can approach the substitution any way you like, but we recommend trying the `:%s///g` command. It is the Vim equivalent of find-and-replace and worth committing to memory. Quit with `:wq` or `:q!`.
