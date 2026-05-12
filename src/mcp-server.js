require('dotenv').config()
const { Server } = require('@modelcontextprotocol/sdk/server/index.js')
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js')
const { CallToolRequestSchema, ListToolsRequestSchema } = require('@modelcontextprotocol/sdk/types.js')
const axios = require('axios')
const { execSync } = require('child_process')

const PIPELINE_URL = `http://localhost:${process.env.PORT || 3333}/pipeline`
const VISION_URL = 'http://177.7.43.80:8000/vision/analyze-base64'

const server = new Server(
  { name: 'ai-core', version: '3.0.0' },
  { capabilities: { tools: {} } }
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'ai_core_pipeline',
      description: 'Pipeline de 6 estágios com contexto semântico dos repositórios. Use para implementações complexas, análise de arquitetura e refatorações.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt:    { type: 'string', description: 'Tarefa ou pergunta' },
          sessionId: { type: 'string', description: 'ID de sessão (opcional)' },
          useVector: { type: 'boolean', description: 'Usar busca vetorial Qdrant' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'clipboard_vision',
      description: 'Lê a imagem atual do clipboard do Windows, analisa via modelo de visão gratuito na VPS e injeta o contexto no pipeline para implementação. Use SEMPRE que o usuário mencionar que copiou, colou ou enviou uma imagem, print ou screenshot.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'O que implementar ou analisar com base na imagem' },
        },
        required: ['prompt'],
      },
    },
    {
      name: 'vision_to_context',
      description: 'Analisa uma imagem em base64 via modelo de visão na VPS e retorna o contexto extraído.',
      inputSchema: {
        type: 'object',
        properties: {
          imageBase64: { type: 'string', description: 'Imagem em base64' },
          mime:        { type: 'string', description: 'Tipo MIME (ex: image/png)', default: 'image/png' },
          prompt:      { type: 'string', description: 'Instrução adicional (opcional)' },
        },
        required: ['imageBase64'],
      },
    },
  ],
}))

async function analyzeImageBase64(imageBase64, mime = 'image/png') {
  const visionRes = await axios.post(VISION_URL, {
    mime,
    content: imageBase64,
  }, { timeout: 120000 })
  const { summary, ocr } = visionRes.data
  return `=== ANÁLISE DE IMAGEM ===\n\n${summary}\n\nTEXTO EXTRAÍDO (OCR):\n${ocr}`
}

async function runPipeline(prompt) {
  const { data } = await axios.post(PIPELINE_URL, { prompt, useVector: false })
  return JSON.parse(data.choices[0].message.content)
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params

  if (name === 'ai_core_pipeline') {
    const { prompt, sessionId, useVector = false } = args
    const { data } = await axios.post(PIPELINE_URL, { prompt, sessionId, useVector })
    const inner = JSON.parse(data.choices[0].message.content)
    return { content: [{ type: 'text', text: JSON.stringify(inner, null, 2) }] }
  }

  if (name === 'clipboard_vision') {
    const { prompt } = args

    // Lê imagem do clipboard via PowerShell
    const psScript = `
Add-Type -AssemblyName System.Windows.Forms
$img = [System.Windows.Forms.Clipboard]::GetImage()
if ($img -eq $null) { Write-Output "NO_IMAGE"; exit }
$ms = New-Object System.IO.MemoryStream
$img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
$bytes = $ms.ToArray()
$b64 = [Convert]::ToBase64String($bytes)
Write-Output $b64
`
    let imageBase64
    try {
      imageBase64 = execSync(`powershell -Command "${psScript.replace(/\n/g, ' ')}"`, {
        encoding: 'utf8',
        timeout: 15000,
      }).trim()
    } catch (err) {
      return { content: [{ type: 'text', text: `Erro ao ler clipboard: ${err.message}` }] }
    }

    if (!imageBase64 || imageBase64 === 'NO_IMAGE') {
      return { content: [{ type: 'text', text: 'Nenhuma imagem encontrada no clipboard. Copie uma imagem com Ctrl+C e tente novamente.' }] }
    }

    // Analisa via VPS
    const context = await analyzeImageBase64(imageBase64)

    // Injeta no pipeline
    const result = await runPipeline(`${prompt}\n\nCONTEXTO DA IMAGEM:\n${context}`)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  }

  if (name === 'vision_to_context') {
    const { imageBase64, mime = 'image/png', prompt = '' } = args
    const context = await analyzeImageBase64(imageBase64, mime)
    if (prompt) {
      const result = await runPipeline(`${prompt}\n\nCONTEXTO DA IMAGEM:\n${context}`)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    }
    return { content: [{ type: 'text', text: context }] }
  }

  throw new Error(`Tool desconhecida: ${name}`)
})

const transport = new StdioServerTransport()
server.connect(transport).then(() => {
  console.error('ai-core MCP server v3.0 pronto (pipeline + clipboard_vision + vision_to_context)')
})
