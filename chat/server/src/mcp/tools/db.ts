/**
 * Shared Database Connection
 * Used by MCP tools that query the database directly
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Navigate from chat/server/src/mcp/tools/ up to chat/ then to sisia.db (symlink)
// __dirname = chat/server/src/mcp/tools
// Go up 4 levels: tools -> mcp -> src -> server -> chat
const dbPath = path.resolve(__dirname, '../../../..', 'sisia.db');

// Shared read-only database connection
export const db = new Database(dbPath, { readonly: true });
