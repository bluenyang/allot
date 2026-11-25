// The MCP server's name and self-description (spec 017 S-5). Pure: the unit tests read it.
export const SERVER_VERSION = '0.1'
/**
 * What the server says about itself in `initialize` (spec 017 S-5): a client that lists MCP servers shows the title and
 * the description. `name` and `version` stay as they were (a client may key its settings on them).
 */
export const SERVER_INFO = {
  name: 'allot',
  version: SERVER_VERSION,
  title: 'Allot',
  description: 'Your self-hosted Allot: read your salary split, income, budgets, accounts, subscriptions and schedule, and propose changes you confirm.',
  websiteUrl: 'https://github.com/bluenyang/allot',
}
