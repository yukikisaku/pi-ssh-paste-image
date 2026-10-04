# pi-ssh-paste-image

## Overview

Paste clipboard text, images, or selected local files from your local machine into Pi running on a remote Unix-like host over SSH. The package contains both a Pi extension and the `pi-ssh-paste-image` CLI.

## Requirements

The local machine needs Node.js 20+ and an OpenSSH `ssh` client. On Linux, clipboard access uses `wl-paste` on Wayland or `xclip`/`xsel` on X11. On macOS, text uses `pbpaste` and images use `pngpaste`. On Windows, clipboard text uses PowerShell `Get-Clipboard`; image clipboard support is not currently implemented on Windows.

The remote machine needs Pi, a POSIX-compatible shell, `rm`, Unix-domain sockets, and an SSH server that permits stream-local forwarding. The normal `ssh` command creates a reverse Unix socket on the remote host. The remote socket is requested with mode `0600` through `StreamLocalBindMask=0177`.

On Linux and macOS, the local clipboard daemon listens on a Unix socket inside a private temporary directory. On Windows, it listens only on an ephemeral `127.0.0.1` TCP port because Node.js does not expose filesystem Unix sockets there. In both cases, requests also require a random per-session token. The daemon reads the clipboard only after you invoke `/paste`, `/ssh-paste`, or the configured shortcut.

Binary clipboard data is written on the remote machine. The default output directory is `/tmp/pi-ssh-paste-image`, created with mode `0700`; saved files are created with mode `0600`. Clipboard text is inserted directly into the Pi editor instead of being written to disk.

## Installation

Install the CLI on the local machine:

```sh
npm install --global @yukikisaku/pi-ssh-paste-image
```

Install the Pi extension on the remote machine where Pi runs:

```sh
pi install npm:@yukikisaku/pi-ssh-paste-image
```

## Usage

Check the local requirements first:

```sh
pi-ssh-paste-image doctor
```

Start Pi through the SSH wrapper:

```sh
pi-ssh-paste-image ssh user@host -- pi
```

The CLI starts the local clipboard daemon, creates a reverse socket on the remote host, exports the required `PI_PASTE_*` values for the remote Pi process, and removes the remote socket when the SSH session exits. While Pi is running, use `/paste`, `/ssh-paste`, or Alt+Shift+V to request the current local clipboard content.

Useful SSH options are `--output-dir DIR`, `--max-bytes SIZE`, `--remote-socket PATH`, and repeatable `--ssh-option VALUE`. The default transfer limit is 20 MiB. Additional SSH options are passed directly to the local `ssh` executable.

## Configuration

Configure `sshPasteImage` in global Pi settings or in a trusted project's `.pi/settings.json`. Supported keys are `shortcut`, `outputDir`, `socketPath`, `token`, `maxBytes`, and `timeoutMs`.

Environment overrides use `PI_PASTE_SOCK`, `PI_PASTE_TOKEN`, `PI_PASTE_OUTPUT_DIR`, `PI_PASTE_MAX_BYTES`, and `PI_PASTE_TIMEOUT_MS`. The normal `pi-ssh-paste-image ssh ...` flow generates the socket path and random token automatically, so you normally do not need to set them yourself.

## Uninstallation

Remove the local CLI:

```sh
npm uninstall --global @yukikisaku/pi-ssh-paste-image
```

Remove the remote Pi package:

```sh
pi uninstall npm:@yukikisaku/pi-ssh-paste-image
```

Remove package-specific Pi configuration if you no longer need it. Files previously saved in the configured output directory are not deleted automatically.

## Pull requests

Pull requests are reviewed by AI and automatically merged when the review and CI pass.

## License

MIT © yuki-kisaku. See [LICENSE](LICENSE).
