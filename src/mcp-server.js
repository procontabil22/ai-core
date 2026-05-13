require('dotenv').config()
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const axios = require('axios')

const PIPELINE_URL = `http://localhost:${process.env.PORT || 3333}/pipeline`

const server = new Server(
  { name: 'ai-core', version: '4.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ai_core_pipeline',
      description: 'Pipeline de 6 estágios com contexto semântico dos repositórios. Use para implementações complexas, análise de arquitetura, refatorações e correções de bugs. Sempre use esta tool quando o usuário pedir para implementar, corrigir ou analisar código.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt:    { type: 'string', description: 'Tarefa, pergunta ou contexto extraído de imagem' },
          sessionId: { type: 'string', description: 'ID de sessão (opcional)' },
          useVector: { type: 'boolean', description: 'Usar busca vetorial Qdrant' },
        },
        required: ['prompt'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'ai_core_pipeline') {
    const { prompt, sessionId, useVector = false } = args
    const { data } = await axios.post(PIPELINE_URL, { prompt, sessionId, useVector })
    const inner = JSON.parse(data.choices[0].message.content)
    return { content: [{ type: 'text', text: JSON.stringify(inner, null, 2) }] }
  }

  throw new Error(`Tool desconhecida: ${name}`)
})

const transport = new StdioServerTransport()
server.connect(transport).then(() => {
  console.error('ai-core MCP server v4.0 pronto')
})
