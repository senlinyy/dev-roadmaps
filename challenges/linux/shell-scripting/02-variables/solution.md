A clean run looks like this:

```bash
$ APP=devpolaris
$ echo 'echo "Deploying $APP..."' > deploy.sh
$ echo 'echo "Log: /var/log/${APP}_deploy.log"' >> deploy.sh
$ bash deploy.sh
Deploying devpolaris...
Log: /var/log/devpolaris_deploy.log
```

Setting `APP=devpolaris` stores the variable in the shell environment. The script references `$APP` and `${APP}_deploy` to expand the variable. Using `bash deploy.sh` runs the script in the current shell's context so it inherits the variable.
