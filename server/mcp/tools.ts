// The MCP server of one request: built per request, bound to the user the key belongs to (stateless).
// Tools arrive in W-4; they are all read-only and run as that user under row-level security.
import { McpServer } from '@modelcontextprotocol/server'

const SERVER_VERSION = '0.1'

export function buildMcpServer(_uid: string): McpServer {
  return new McpServer({ name: 'allot', version: SERVER_VERSION }, { capabilities: { tools: {} } })
}
