require('dotenv').config()

const express = require('express')
const cors = require('cors')

const { buildContext } = require('./graph/contextBuilder')
const { runPipeline, isPremiumPrompt } = require('./graph/pipelineGraph')

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// â”€â”€â”€ ROTA PRINCIPAL (sem stream â€” compatibilidade legada) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/pipeline', async (req, res) => {
  try {
    const { prompt, sessionId, useVector = false } = req.body

    if (!prompt) {
      return res.status(400).json({ error: 'prompt Ã© obrigatÃ³rio' })
    }

    console.log('\n=== /pipeline ===')
    console.log('PROMPT:', prompt.slice(0, 100))
    console.log('PREMIUM:', isPremiumPrompt(prompt))

    const context = await buildContext(prompt, { sessionId, useVector })
    console.log(`CONTEXT SIZE: ${context.length} chars`)

    const result = await runPipeline(prompt, context, req.body.imageBase64 || null)

    res.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              pipeline: result.models,
              premium_activated: result.premiumActivated,
              context: {
                repositories: 2,
                contextSize: context.length,
                mode: useVector ? 'vector (Qdrant)' : 'local (semÃ¢ntica)',
              },
              timings: result.timings,
              total_ms: result.totalMs,
              route: result.route,
              answer: result.finalContent,
            }),
          },
        },
      ],
    })
  } catch (error) {
    console.error('[/pipeline] ERRO:', error.response?.data || error.message)
    res.status(500).json({ error: error.response?.data || error.message })
  }
})

// â”€â”€â”€ ROTA SSE â€” progresso em tempo real para o opencode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
//
// Protocolo:
//   data: {"type":"progress","stage":"...","status":"...","msg":"..."}
//   data: {"type":"result","content":{...}}
//   data: {"type":"error","message":"..."}
//   data: [DONE]
//
app.post('/pipeline/stream', async (req, res) => {
  const { prompt, sessionId, useVector = false } = req.body

  if (!prompt) {
    return res.status(400).json({ error: 'prompt Ã© obrigatÃ³rio' })
  }

  // Configura SSE
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')  // desativa buffer do nginx/proxy
  res.flushHeaders()

  // Helper para enviar eventos SSE
  const send = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`)
    // forÃ§a flush imediato se disponÃ­vel
    if (typeof res.flush === 'function') res.flush()
  }

  try {
    // Contexto
    send({ type: 'progress', stage: 'CONTEXT', status: 'start', msg: 'ðŸ“‚ [CONTEXT] Construindo contexto semÃ¢ntico...' })
    const context = await buildContext(prompt, { sessionId, useVector })
    send({ type: 'progress', stage: 'CONTEXT', status: 'done', msg: `âœ… [CONTEXT] ${context.length} chars carregados` })

    // Pipeline com callback de progresso
    const result = await runPipeline(prompt, context, null, (event) => {
      send({ type: 'progress', ...event })
    })

    // Resultado final
    send({
      type: 'result',
      content: {
        pipeline: result.models,
        premium_activated: result.premiumActivated,
        context: {
          repositories: 2,
          contextSize: context.length,
          mode: useVector ? 'vector (Qdrant)' : 'local (semÃ¢ntica)',
        },
        timings: result.timings,
        total_ms: result.totalMs,
        answer: result.finalContent,
      },
    })

    send('[DONE]')
    res.end()
  } catch (error) {
    console.error('[/pipeline/stream] ERRO:', error.message)
    send({ type: 'error', message: error.response?.data || error.message })
    send('[DONE]')
    res.end()
  }
})

// â”€â”€â”€ ROTA DE DEBUG â€” testa sÃ³ o contexto â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/debug/context', async (req, res) => {
  try {
    const { prompt, useVector = false } = req.body
    const context = await buildContext(prompt, { useVector })
    res.json({
      prompt,
      mode: useVector ? 'vector' : 'local',
      context_size: context.length,
      context_preview: context.slice(0, 2000),
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// â”€â”€â”€ ROTA DE DEBUG â€” testa estÃ¡gios individualmente â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/debug/stage/:n', async (req, res) => {
  try {
    const { prompt } = req.body
    const stage = parseInt(req.params.n)
    const context = await buildContext(prompt)
    const axios = require('axios')

    const stageConfigs = {
      1: { model: 'google/gemini-2.5-flash', label: 'PLANNER' },
      2: { model: 'google/gemini-2.5-flash', label: 'PARSER' },
      3: { model: 'deepseek/deepseek-chat',  label: 'IMPLEMENTER' },
      4: { model: 'minimax/minimax-m2',       label: 'COMPRESSOR' },
      5: { model: 'deepseek/deepseek-chat',  label: 'REVIEW' },
      6: { model: 'anthropic/claude-sonnet-4-5', label: 'PREMIUM' },
    }

    const cfg = stageConfigs[stage]
    if (!cfg) return res.status(400).json({ error: 'stage deve ser 1-6' })

    const startTime = Date.now()
    const response = await axios.post(
      'https://openrouter.ai/api/v1/chat/completions',
      { model: cfg.model, messages: [{ role: 'user', content: `${prompt}\n\nCONTEXT:\n${context.slice(0, 4000)}` }] },
      { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' } }
    )
    const content = response.data.choices[0].message.content
    const modelUsed = response.data.model

    res.json({
      stage, label: cfg.label,
      model_requested: cfg.model, model_used: modelUsed,
      fallback_detected: modelUsed !== cfg.model,
      duration_ms: Date.now() - startTime,
      tokens: response.data.usage,
      response_size: content.length,
      response_preview: content.slice(0, 1000),
    })
  } catch (error) {
    res.status(500).json({ error: error.response?.data || error.message })
  }
})

// â”€â”€â”€ ROTA DE DEBUG â€” indexa repositÃ³rios no Qdrant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.post('/debug/index', async (req, res) => {
  try {
    const { indexAllRepositories } = require('./graph/contextBuilder')
    await indexAllRepositories()
    res.json({ ok: true, message: 'RepositÃ³rios indexados no Qdrant' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// â”€â”€â”€ HEALTH CHECK â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    pipeline: '6 stages',
    streaming: 'POST /pipeline/stream (SSE)',
    models: {
      planner: 'deepseek/deepseek-v4-flash',
      implementer: 'deepseek/deepseek-v4-flash',
      compressor: 'minimax/minimax-m2',
      reviewer: 'deepseek/deepseek-chat-v3-0324',
      enterprise: 'deepseek/deepseek-r1 (fallback: claude-sonnet-4-5)',
    },
    memory: {
      vector: 'Qdrant (localhost:6333)',
      session: 'Redis (localhost:6380)',
    },
  })
})

app.listen(process.env.PORT || 3000, () => {
  console.log(`\n=== AI-CORE PIPELINE ===`)
  console.log(`PORT: ${process.env.PORT || 3000}`)
  console.log(`VECTOR MEMORY: Qdrant localhost:6333`)
  console.log(`SESSION MEMORY: Redis localhost:6380`)
  console.log(`ROTAS:`)
  console.log(`  POST /pipeline          (legado, sem stream)`)
  console.log(`  POST /pipeline/stream   (SSE â€” progresso em tempo real)`)
  console.log(`  POST /debug/context`)
  console.log(`  POST /debug/stage/:n    (1-6)`)
  console.log(`  POST /debug/index`)
  console.log(`  GET  /health`)
})

