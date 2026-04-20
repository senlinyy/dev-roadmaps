```bash
$ vim /etc/nginx/nginx.conf
```

In vim, use `/server_name` to jump to the line. Press `i` to enter Insert mode. Change `_` to `devpolaris.dev`. Press `Esc`, then type `:wq` and `Enter` to save and quit.

You can verify your change with `cat /etc/nginx/nginx.conf` and look for `server_name devpolaris.dev;`.
