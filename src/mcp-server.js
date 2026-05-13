require('dotenv').config()
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const http = require('http')

const PORT = process.env.PORT || 3333
const HOST = 'localhost'

// â”€â”€â”€ Consome a rota SSE /pipeline/stream â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Retorna { result, progressLog } onde progressLog Ã© array de msgs
function callPipelineStream(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body)
    const progressLog = []
    let resultData = null
    let buffer = ''

    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: '/pipeline/stream',
        method: 'POST',
        timeout: 300000, // 5 minutos â€” pipeline complexo pode levar 2-3min
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
      },
      (res) => {
        res.setEncoding('utf8')

        res.on('data', (chunk) => {
          buffer += chunk

          // processa linhas SSE completas
          const lines = buffer.split('\n')
          buffer = lines.pop() // guarda linha incompleta

          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') continue

            try {
              const event = JSON.parse(raw)

              if (event.type === 'progress') {
                progressLog.push(event.msg)
                // ecoa no stderr para aparecer nos logs do pm2
                process.stderr.write(event.msg + '\n')
              }

              if (event.type === 'result') {
                resultData = event.content
              }

              if (event.type === 'error') {
                reject(new Error(event.message))
              }
            } catch (_) {
              // linha SSE malformada â€” ignora
            }
          }
        })

        res.on('end', () => {
          if (resultData) {
            resolve({ result: resultData, progressLog })
          } else {
            reject(new Error('Pipeline nÃ£o retornou resultado'))
          }
        })
      }
    )

    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Pipeline timeout apÃ³s 5 minutos'))
    })
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

// â”€â”€â”€ MCP SERVER â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const server = new Server(
  { name: 'ai-core', version: '4.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ai_core_pipeline',
      description: 'Pipeline de 6 estÃ¡gios com contexto semÃ¢ntico dos repositÃ³rios. Use para implementaÃ§Ãµes complexas, anÃ¡lise de arquitetura, refatoraÃ§Ãµes e correÃ§Ãµes de bugs. Sempre use esta tool quando o usuÃ¡rio pedir para implementar, corrigir ou analisar cÃ³digo.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt:    { type: 'string', description: 'Tarefa, pergunta ou contexto extraÃ­do de imagem' },
          sessionId: { type: 'string', description: 'ID de sessÃ£o (opcional)' },
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

    const { result, progressLog } = await callPipelineStream({ prompt, sessionId, useVector })

    // â”€â”€ Monta o texto de progresso visÃ­vel no opencode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    const progressSection = progressLog.length > 0
      ? `\n\n---\n**ðŸ”„ Pipeline executado â€” etapas:**\n${progressLog.map(l => `> ${l}`).join('\n')}\n---\n`
      : ''

    // â”€â”€ Monta o conteÃºdo final que o opencode vai exibir â”€â”€â”€â”€â”€â”€â”€â”€
    const summaryLines = [
      `**Rota:** ${result.pipeline ? Object.keys(result.pipeline).join(' â†’ ') : 'N/A'}`,
      `**Premium:** ${result.premium_activated ? 'Sim âœ¨' : 'NÃ£o'}`,
      `**Tempo total:** ${result.total_ms ? (result.total_ms / 1000).toFixed(1) + 's' : 'N/A'}`,
      `**Contexto:** ${result.context?.contextSize ?? 'N/A'} chars`,
    ]

    if (result.timings) {
      const timingLines = Object.entries(result.timings)
        .map(([k, v]) => `  - ${k}: ${(v / 1000).toFixed(1)}s`)
        .join('\n')
      summaryLines.push(`**Timings:**\n${timingLines}`)
    }

    const fullText = `${progressSection}\n${summaryLines.join('\n')}\n\n---\n\n${result.answer ?? ''}`

    return {
      content: [{ type: 'text', text: fullText }],
    }
  }

  throw new Error(`Tool desconhecida: ${name}`)
})

const transport = new StdioServerTransport()
server.connect(transport).then(() => {
  process.stderr.write('ai-core MCP server v4.0 pronto (stream mode)\n')
})

