# Third-party notices

The optional project-local Hermes runtime installer downloads Nous Research Hermes
Agent 0.23.1 (commit `3b421578588243f920886e6fe79a6faa87ea026e`) under its MIT license,
retained in the verified upstream source archive. Its standalone CPython 3.14.9
distribution retains the Python and bundled-library notices. Frozen Python
dependencies retain their individual upstream licenses in the private installed
environment. These downloads are ignored local tools, not a redistributed first-party
bundle. Source: <https://github.com/NousResearch/hermes-agent>.

The optional Agent Center execution environment is a separate frozen copy of the
same pinned source with the upstream `sms` dependency extra, providing the aiohttp
HTTP runtime family. No SMS integration is enabled. Its installed distributions
retain their upstream notices; the minimal core environment is unchanged.

The UI primitives in `apps/console/src/components/ui` were obtained from the official shadcn/ui new-york registry on 2026-11-11, then formatted and adapted locally. Source: <https://github.com/shadcn-ui/ui>. Their MIT license is retained in `licenses/shadcn-ui.txt`. Other dependencies retain their licenses in the package distribution; no ownership of those libraries is claimed.

The optional local coding-runner installers retain separately pinned private tool
assets: OpenAI Codex `0.167.0-alpha.4.1` (platform package metadata: Apache-2.0),
Anthropic Claude Code `2.1.215` (Anthropic PBC, all rights reserved; subject to
[upstream terms](https://code.claude.com/docs/en/legal-and-compliance)),
Node.js `24.22.1` (Node and bundled third-party notices), Git `2.53.0`
(GPL-2.0 and component terms), signed Ubuntu Bash `5.3-2ubuntu1` (actual `5.3.9`,
GNU GPL and component notices), its libtinfo runtime and the integrity-matched
Codex-bundled bubblewrap, QEMU `10.2.1` and Linux `7.0.0-30` with their
upstream/distribution component terms. The installers retain vendor notices and
package provenance in ignored local assets, including `licenses/codex.txt`,
`licenses/claude.txt`, `licenses/node.txt`, `licenses/git.txt` and `licenses/bash.txt` in the CLI asset
root. Fixed observed Ubuntu ELF runtime dependencies retain distribution license
obligations. The CLI asset manifest contains 19 entries. Vendor-bundled bubblewrap component
license/source obligations require separate review before any redistribution.
These assets are private project-local downloads; no binary
redistribution or general license-compatibility approval is claimed. See
[coding runner operations](docs/development/coding-runners.md).
