```bash
vim logging.conf
```

Enter each command in Vim and press `Enter`:

```vim
:%s/info/debug/
:w
:%s/debug/trace/
:q
:q!
```

The ordinary quit shows E37; the forced quit returns to the shell.

```bash
cat logging.conf
```

The saved value stays `debug`, not `info` or `trace`.
