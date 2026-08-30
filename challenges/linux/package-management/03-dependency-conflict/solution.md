```bash
sudo apt install app-server
apt-cache policy libfoo
sudo apt-mark unhold libfoo
sudo apt install app-server
```

The first attempt proves that the hold blocks dependency resolution. The candidate `2.1.0` satisfies the application requirement, so removing the hold allows APT to upgrade `libfoo` and install `app-server` together.
