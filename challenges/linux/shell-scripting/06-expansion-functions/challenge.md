---
title: "Parameter Expansion and Functions"
sectionSlug: parameter-expansion-and-readonly
order: 6
---

Bash parameter expansion lets you manipulate strings without external commands. Combined with functions and `local` variables, you can write clean, reusable scripts.

You start in `/home/dev`. Your job:

1. **Open vim** with `vim pathutil.sh` and write a script that:
   - Starts with `#!/usr/bin/env bash` and `set -euo pipefail`
   - Defines a variable `filepath="/var/log/myapp/server.log"`
   - Uses `${filepath%/*}` to extract the directory into a `directory` variable
   - Uses `${filepath##*/}` to extract the filename into a `filename` variable
   - Uses `${filename%.*}` to extract the base name (without extension) into a `basename` variable
   - Prints all three values with `echo "$directory" "$filename" "$basename"`
   - Save with `:wq`
2. **Open vim** with `vim greet.sh` and write a script that:
   - Defines a function `greet` using `greet() { ... }`
   - Inside the function, declares `local name="$1"` and prints `Hello, $name`
   - Calls `greet DevPolaris` after the function definition
   - Save with `:wq`
3. **Make both executable** with `chmod +x`.

The grader checks that both scripts contain the correct expansion patterns and function structure.
