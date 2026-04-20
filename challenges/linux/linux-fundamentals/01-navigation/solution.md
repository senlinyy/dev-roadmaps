A clean run looks like this:

```bash
$ pwd
$ cd /etc
$ ls
$ cd
$ ls -a
```

`cd` with no argument returns you to `$HOME`. The default `ls` hides any name starting with `.`, so the final `ls -a` is what reveals `.bashrc` and `.config`.
