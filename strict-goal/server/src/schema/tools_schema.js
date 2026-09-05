import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const toolsSchemaPath = fileURLToPath(new URL('../../schemas/tools.json', import.meta.url));

export const TOOL_SCHEMAS = JSON.parse(readFileSync(toolsSchemaPath, 'utf8')).tools;
