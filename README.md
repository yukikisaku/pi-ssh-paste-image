# pi-ssh-paste-image

## Overview

Paste local clipboard text or images into Pi running over SSH.

## Requirements

Requires Node.js 20+, OpenSSH, and platform clipboard tools. The CLI opens a reverse Unix-socket bridge and passes a random token to remote Pi. Pasted images are written on the remote host; the default directory is `/tmp/pi-ssh-paste-image`.

## Installation

```sh
pi install npm:@yukikisaku/pi-ssh-paste-image
```

## Usage

Run `pi-ssh-paste-image ssh user@host -- pi`, then use `/paste` or Alt+Shift+V in remote Pi. `pi-ssh-paste-image doctor` checks local requirements.

## Configuration

Configure `sshPasteImage` in global or trusted project Pi settings. Supported keys are `shortcut`, `outputDir`, `socketPath`, `token`, `maxBytes`, and `timeoutMs`. Environment overrides use `PI_PASTE_SOCK`, `PI_PASTE_TOKEN`, `PI_PASTE_OUTPUT_DIR`, `PI_PASTE_MAX_BYTES`, and `PI_PASTE_TIMEOUT_MS`.

## Uninstallation

```sh
pi uninstall npm:@yukikisaku/pi-ssh-paste-image
```

Remove any package-specific configuration described above if you no longer need it.

## License

MIT © yuki-kisaku. See [LICENSE](LICENSE).
