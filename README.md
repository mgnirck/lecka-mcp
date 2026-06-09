# lecka-mcp

A Model Context Protocol (MCP) server for the Lecka sports nutrition platform. It exposes tools that let MCP-compatible AI clients (like Claude) query products, calculate race fueling plans, and retrieve personalized nutrition data.

Built with [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk) and deployed on Vercel.

## Tools

| Tool | Description |
|------|-------------|
| `get_products` | Returns the full catalog of Lecka nutrition products |
| `calculate_fueling_plan` | Calculates a race-day fueling plan based on duration, intensity, and athlete data |
| `get_nutrition_data` | Retrieves per-product nutrition data (carbs, calories, electrolytes, etc.) |

## MCP Server URL

```
https://lecka-mcp.vercel.app/mcp
```

## Connect with Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "lecka": {
      "url": "https://lecka-mcp.vercel.app/mcp"
    }
  }
}
```

On macOS the config file lives at `~/Library/Application Support/Claude/claude_desktop_config.json`.

## Development

```bash
npm install
npm start
```
