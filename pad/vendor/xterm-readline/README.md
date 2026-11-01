# Xterm Readline in LabPad

Upstream: https://github.com/strtok/xterm-readline
Version: 1.3.1, revision 0870644ef26f2864b837bc535c2df60a87262a87.
License: MIT; see LICENSE-MIT. Source is retained so the terminal integration can use explicit APIs.

LabPad changes: ephemeral UTF-8 byte bounded history; process output above an active prompt; abort/read lifecycle; word movement and deletion; grapheme-aware left/right and deletion; history recall preserves the draft. No shell command evaluation is enabled.

Keep UPSTREAM.json, license, adapted source and terminal tests together when updating.
