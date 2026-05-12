require('dotenv').config()

const express = require('express')
const cors = require('cors')

const { buildContext } = require('./graph/contextBuilder')
const { runPipeline, isPremiumPrompt } = require('./graph/pipelineGraph')

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))

// ─── ROTA PRINCIPAL ────────────────────────────────────────────────
app.post('/pipeline', async (req, res) => {
  try {
    const { prompt, sessionId, useVector = false } = req.body

    if (!prompt) {
      return res.status(400).json({ error: 'prompt é obrigatório' })
    }

    console.log('\n=== /pipeline ===')
    console.log('PROMPT:', prompt.slice(0, 100))
    console.log('PREMIUM:', isPremiumPrompt(prompt))

    const context = await buildContext(prompt, { sessionId, useVector })

    console.log(`CONTEXT SIZE: ${context.length} chars`)

    const result = await runPipeline(prompt, context)

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
                mode: useVector ? 'vector (Qdrant)' : 'local (semântica)',
              },
              timings: result.timings,
              total_ms: result.totalMs,
              stages: result.stages,
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

// ─── ROTA DE DEBUG — testa só o contexto ──────────────────────────
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

// ─── ROTA DE DEBUG — testa estágios individualmente ───────────────
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
      {
        model: cfg.model,
        messages: [{ role: 'user', content: `${prompt}\n\nCONTEXT:\n${context.slice(0, 4000)}` }],
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    )

    const content = response.data.choices[0].message.content
    const modelUsed = response.data.model

    res.json({
      stage,
      label: cfg.label,
      model_requested: cfg.model,
      model_used: modelUsed,
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

// ─── ROTA DE DEBUG — indexa repositórios no Qdrant ────────────────
app.post('/debug/index', async (req, res) => {
  try {
    const { indexAllRepositories } = require('./graph/contextBuilder')
    await indexAllRepositories()
    res.json({ ok: true, message: 'Repositórios indexados no Qdrant' })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// ─── HEALTH CHECK ──────────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    pipeline: '6 stages',
    models: {
      planner: 'google/gemini-2.5-flash',
      parser: 'google/gemini-2.5-flash',
      implementer: 'deepseek/deepseek-chat',
      compressor: 'minimax/minimax-m2',
      review1: 'deepseek/deepseek-chat',
      review2: 'anthropic/claude-sonnet-4-5 (premium)',
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
  console.log(`  POST /pipeline`)
  console.log(`  POST /debug/context`)
  console.log(`  POST /debug/stage/:n  (1-6)`)
  console.log(`  POST /debug/index`)
  console.log(`  GET  /health`)
})
