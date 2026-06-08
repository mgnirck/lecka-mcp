import pg from 'pg'

const { Client } = pg

const client = new Client({
  connectionString: process.env.POSTGRES_URL_NON_POOLING,
  ssl: { rejectUnauthorized: false },
})

await client.connect()

await client.query(`
  CREATE TABLE IF NOT EXISTS mcp_tool_calls (
    id          SERIAL PRIMARY KEY,
    tool        TEXT NOT NULL,
    params      JSONB,
    region      TEXT,
    race_type   TEXT,
    error       BOOLEAN DEFAULT FALSE,
    duration_ms INTEGER,
    called_at   TIMESTAMPTZ DEFAULT NOW()
  )
`)

await client.query(`CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_tool ON mcp_tool_calls(tool)`)
await client.query(`CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_called_at ON mcp_tool_calls(called_at)`)
await client.query(`CREATE INDEX IF NOT EXISTS idx_mcp_tool_calls_region ON mcp_tool_calls(region)`)

await client.end()
console.log('Migration complete — mcp_tool_calls table is ready.')
