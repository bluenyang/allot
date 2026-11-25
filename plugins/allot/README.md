# Allot for Claude Code (OAuth)

Connects Claude Code to your own self-hosted [Allot](https://github.com/bluenyang/allot) server and adds seven money
skills: month start, payday, month end, subscriptions, receipts, spending plan and assets. Claude reads your Allot
data through the server's MCP endpoint and proposes changes; nothing changes until you confirm a proposal in Allot
(or in the chat, when you allowed that on the consent screen).

## Install

```
/plugin marketplace add bluenyang/allot
/plugin install allot@allot
```

Claude Code asks for your server's MCP address (Allot › Settings › AI shows it, e.g. `https://allot.example.com/mcp`).
On first use it opens Allot's sign-in and consent screen in your browser; choose read, propose (confirm on the
screen) or propose (confirm in the chat). Your Allot admin must turn on external app connections first
(Admin › Login methods), and the server must be on https (or http on localhost).

On a private network without https, use the `allot-key` plugin with an API key instead.
Install only one of `allot` and `allot-key`: when two plugins name the same MCP address, Claude Code keeps only one of
the two servers.

## Privacy

The plugin talks only to the Allot server you name. Allot is self-hosted: your data stays on your server.
Disconnect the app any time in Allot › Settings › AI › Connected apps.
