# Allot for Claude Code (API key)

Connects Claude Code to your own self-hosted [Allot](https://github.com/bluenyang/allot) server with an Allot API key
and adds seven money skills: month start, payday, month end, subscriptions, receipts, spending plan and assets.
Claude reads your Allot data through the server's MCP endpoint and proposes changes; nothing changes until you
confirm a proposal (where depends on the key: in Allot under Pending changes, or in the chat).

Use this plugin when your server is only on a private network (no https), or when external app connections (OAuth)
are off. Otherwise the `allot` plugin signs in with OAuth and needs no key.

## Install

```
/plugin marketplace add bluenyang/allot
/plugin install allot-key@allot
```

Claude Code asks for the MCP address (Allot › Settings › AI shows it) and the API key you make on the same screen.
The key is stored as a secret. A read key gives the twelve read tools; a write key adds the four proposal tools.

## Privacy

The plugin talks only to the Allot server you name, with your key. Revoke the key any time in Allot › Settings › AI.
