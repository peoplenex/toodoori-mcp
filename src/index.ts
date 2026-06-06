#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { ToodooriClient } from './client.js';
import { registerTools } from './tools.js';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const api = new ToodooriClient(cfg);

  const server = new McpServer({ name: 'toodoori-mcp', version: '0.1.0' });
  registerTools(server, api);

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // stdout은 MCP 프로토콜 전용 → 로그는 stderr로만
  console.error(`[toodoori-mcp] connected · API=${cfg.origin}`);
}

main().catch((err: unknown) => {
  console.error('[toodoori-mcp] fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
