const axios = require('axios')

const VISION_URL = 'http://177.7.43.80:8000/vision/analyze-base64'

const LANGUAGE_RULES = `
REGRAS OBRIGATÓRIAS:
- Responda SEMPRE em português brasileiro (pt-BR)
- Código-fonte, variáveis e nomes de frameworks permanecem em inglês
- Seja direto, objetivo e enterprise-level
- Retorne SEMPRE o código completo, nunca truncado
`

const MODELS = {
  flash:   'deepseek/deepseek-v4-flash',
  pro:     'deepseek/deepseek-v4-pro',
  minimax: 'minimax/minimax-m2',
  sonnet:  'anthropic/claude-sonnet-4-6',
  vision:  'google/gemini-2.0-flash-exp:free',
  context: 'google/gemini-2.5-flash-preview-05-20',
}

function classifyTask(prompt) {
  const p = prompt.toLowerCase()
  const isPremium = ['security','auth','jwt','autenticacao','autenticação','distributed','multi-tenant','payment','pagamento','middleware','prisma','critical','enterprise','permission','rbac'].some(t => p.includes(t))
  const isSimple  = ['fix','corrig','erro','error','bug','typo','rename','renomear','delete','remov','adiciona import','add import','linha','variavel','variable'].some(t => p.includes(t))
  const isComplex = ['refactor','refatora','arquitetura','architecture','pipeline','módulo','module','implement','implemente','integra','criar','create','componente','component','page','página','funcionalidade','feature'].some(t => p.includes(t))
  if (isPremium) return 'premium'
  if (isSimple && !isComplex) return 'simple'
  return 'complex'
}

function hasImage(prompt, imageBase64) {
  return !!imageBase64 || prompt.includes('[Image') || prompt.includes('imagem') || prompt.includes('screenshot') || prompt.includes('print') || prompt.includes('tela')
}

async function callModel(model, prompt, label = '', imageBase64 = null, fallback = null) {
  const start = Date.now()
  const buildMessages = (content) => {
    if (imageBase64) {
      return [{ role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
        { type: 'text', text: content }
      ]}]
    }
    return [{ role: 'user', content }]
  }
  const modelsToTry = [model, fallback].filter(Boolean)
  for (const currentModel of modelsToTry) {
    if (currentModel !== model) console.log(`[${label}] FALLBACK → ${currentModel}`)
    try {
      const res = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        { model: currentModel, messages: buildMessages(prompt) },
        { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' }, timeout: 120000 }
      )
      const content = res.data.choices[0].message.content
      const modelUsed = res.data.model
      const duration = Date.now() - start
      if (!content || content.length < 20) throw new Error('Resposta vazia')
      console.log(`[${label}] ✓ ${modelUsed} — ${duration}ms — ${content.length} chars`)
      return { content, modelUsed, duration }
    } catch (err) {
      console.warn(`[${label}] ERRO ${currentModel}: ${err.message}`)
      if (currentModel === modelsToTry[modelsToTry.length - 1]) throw err
    }
  }
}

// ═══════════════════════════════════════════════════════
// STAGE 0 — GEMINI FLASH: EXTRAÇÃO INTELIGENTE DE CONTEXTO
// Lê o repositório completo e extrai APENAS o que é
// relevante para a tarefa. Contexto cirúrgico.
// ═══════════════════════════════════════════════════════
async function extractSmartContext(prompt, fullContext, complexity) {
  console.log('[CONTEXT] Gemini Flash extraindo contexto relevante...')
  const start = Date.now()

  const maxContext = {
    simple:  3000,
    complex: 6000,
    premium: 10000,
  }[complexity]

  try {
    const res = await callModel(
      MODELS.context,
      `Você é um especialista em análise de código. Analise o contexto do repositório abaixo e extraia APENAS as partes relevantes para a tarefa solicitada.

TAREFA: ${prompt}

CONTEXTO COMPLETO DO REPOSITÓRIO:
${fullContext}

INSTRUÇÕES:
- Extraia apenas arquivos, funções, tipos e padrões diretamente relacionados à tarefa
- Ignore código não relacionado
- Mantenha imports relevantes
- Preserve padrões de nomenclatura e arquitetura usados no projeto
- Limite a resposta a ${maxContext} caracteres
- Se a tarefa for simples, seja mais conciso
- Se for complexa, inclua mais contexto arquitetural

Retorne apenas o contexto extraído, sem explicações.`,
      'CONTEXT-GEMINI-FLASH'
    )

    const duration = Date.now() - start
    console.log(`[CONTEXT] Contexto original: ${fullContext.length} chars → Extraído: ${res.content.length} chars (${Math.round(res.content.length/fullContext.length*100)}%) em ${duration}ms`)
    return res.content

  } catch (err) {
    console.warn(`[CONTEXT] Gemini falhou — usando contexto bruto limitado: ${err.message}`)
    return fullContext.slice(0, maxContext)
  }
}

// ═══════════════════════════════════════════════════════
// VISÃO — Gemini Flash FREE (apenas leitura de imagem)
// ═══════════════════════════════════════════════════════
async function analyzeImage(imageBase64) {
  console.log('[VISION] Gemini Flash — interpretando imagem...')
  try {
    const res = await callModel(
      MODELS.vision,
      `Analise esta imagem de interface/sistema e extraia:
1. Tipo: (UI, erro, formulário, grid, dashboard, código)
2. Texto visível completo (labels, mensagens, valores, botões)
3. Componentes identificados (tabelas, filtros, modais, inputs)
4. Problemas visíveis (erros, campos vazios, dados incorretos)
5. Contexto técnico (nome de rotas, variáveis, IDs visíveis)
Retorne em formato estruturado para uso como contexto de implementação.`,
      'VISION-GEMINI-FLASH',
      imageBase64
    )
    return res.content
  } catch (err) {
    console.warn('[VISION] Gemini falhou — usando VPS minicpm-v')
    try {
      const vpsRes = await axios.post(VISION_URL, { mime: 'image/png', content: imageBase64 }, { timeout: 120000 })
      return `${vpsRes.data.summary}\n\nOCR:\n${vpsRes.data.ocr}`
    } catch (vpsErr) {
      console.warn('[VISION] VPS também falhou:', vpsErr.message)
      return ''
    }
  }
}

// ═══════════════════════════════════════════════════════
// ROTA SIMPLES — Flash direto com contexto enxuto
// ═══════════════════════════════════════════════════════
async function routeSimple(prompt, smartContext) {
  console.log('\n[ROUTER] ▶ SIMPLES — DeepSeek V4 Flash')
  const t = Date.now()
  const result = await callModel(
    MODELS.flash,
    `${LANGUAGE_RULES}

CONTEXTO RELEVANTE DO REPOSITÓRIO:
${smartContext}

TAREFA:
${prompt}

Resolva de forma direta. Retorne o código completo corrigido com explicação objetiva.`,
    'SIMPLE-FLASH'
  )
  return {
    finalContent: result.content,
    route: 'simple',
    premiumActivated: false,
    models: { implementer: result.modelUsed },
    timings: { simple_ms: Date.now() - t },
    totalMs: Date.now() - t,
  }
}

// ═══════════════════════════════════════════════════════
// ROTA COMPLEXA — contexto cirúrgico em cada estágio
// ═══════════════════════════════════════════════════════
async function routeComplex(prompt, smartContext, visionContext = '') {
  console.log('\n[ROUTER] ▶ COMPLEXA — Flash→Pro→Minimax→Pro')
  const timings = {}
  const models = {}
  const enriched = visionContext
    ? `${prompt}\n\n=== CONTEXTO VISUAL DA IMAGEM ===\n${visionContext}`
    : prompt

  // Stage 1 — Flash planeja
  const t1 = Date.now()
  const plan = await callModel(
    MODELS.flash,
    `${LANGUAGE_RULES}

CONTEXTO RELEVANTE DO REPOSITÓRIO:
${smartContext}

TAREFA:
${enriched}

Crie um plano de implementação detalhado:
- Liste os arquivos a modificar com caminho completo
- Descreva as alterações em cada arquivo
- Identifique dependências e riscos
NÃO escreva código ainda — apenas planeje.`,
    'PLAN-FLASH'
  )
  timings.plan_ms = Date.now() - t1
  models.planner = plan.modelUsed

  // Stage 2 — Pro implementa
  const t2 = Date.now()
  const impl = await callModel(
    MODELS.pro,
    `${LANGUAGE_RULES}

PLANO DE IMPLEMENTAÇÃO:
${plan.content}

CONTEXTO RELEVANTE DO REPOSITÓRIO:
${smartContext}

Execute o plano. Gere código completo, tipado e production-ready.
Inclua todos os imports, tipos TypeScript e tratamento de erros.`,
    'IMPL-PRO'
  )
  timings.impl_ms = Date.now() - t2
  models.implementer = impl.modelUsed

  // Stage 3 — Minimax comprime
  const t3 = Date.now()
  const compressed = await callModel(
    MODELS.minimax,
    `${LANGUAGE_RULES}

Organize e comprima esta implementação:
- Elimine redundâncias mantendo toda a lógica
- Estruture de forma limpa e legível
- Preserve imports, tipos e lógica de negócio

IMPLEMENTAÇÃO:
${impl.content}`,
    'COMPRESS-MINIMAX'
  )
  timings.compress_ms = Date.now() - t3
  models.compressor = compressed.modelUsed

  // Stage 4 — Pro revisa
  const t4 = Date.now()
  const reviewed = await callModel(
    MODELS.pro,
    `${LANGUAGE_RULES}

Revise esta implementação criticamente:
- Verifique erros TypeScript e bugs lógicos
- Confira edge cases e tratamento de erros
- Valide que atende à tarefa: "${prompt.slice(0, 200)}"
- Se encontrar problemas, corrija-os

Retorne a versão FINAL completa e production-ready.

IMPLEMENTAÇÃO:
${compressed.content}`,
    'REVIEW-PRO'
  )
  timings.review_ms = Date.now() - t4
  models.reviewer = reviewed.modelUsed

  const totalMs = Object.values(timings).reduce((a, b) => a + b, 0)
  return { finalContent: reviewed.content, route: 'complex', premiumActivated: false, models, timings, totalMs }
}

// ═══════════════════════════════════════════════════════
// ROTA PREMIUM — contexto completo + Sonnet
// ═══════════════════════════════════════════════════════
async function routePremium(prompt, smartContext, visionContext = '') {
  console.log('\n[ROUTER] ▶ PREMIUM — Flash→Pro→Minimax→Pro→Sonnet4.6')
  const complex = await routeComplex(prompt, smartContext, visionContext)
  const t5 = Date.now()
  const premium = await callModel(
    MODELS.sonnet,
    `${LANGUAGE_RULES}

Faça revisão enterprise desta implementação:

TAREFA ORIGINAL: ${prompt.slice(0, 300)}

IMPLEMENTAÇÃO:
${complex.finalContent}

Foque em: segurança, autenticação, multi-tenancy, race conditions, validações, padrões enterprise.
Retorne a versão final refinada e production-ready.`,
    'PREMIUM-SONNET-4.6',
    null,
    MODELS.sonnet
  )
  return {
    finalContent: premium.content,
    route: 'premium',
    premiumActivated: true,
    models: { ...complex.models, premium: premium.modelUsed },
    timings: { ...complex.timings, premium_ms: Date.now() - t5 },
    totalMs: complex.totalMs + (Date.now() - t5),
  }
}

// ═══════════════════════════════════════════════════════
// ORQUESTRADOR PRINCIPAL v6.0
// ═══════════════════════════════════════════════════════
async function runPipeline(prompt, context, imageBase64 = null) {
  const totalStart = Date.now()

  console.log('\n╔══════════════════════════════════════════════════╗')
  console.log('║   AI-CORE ORQUESTRADOR v6.0                      ║')
  console.log('║   Gemini(context) → Flash(plan) → Pro(impl)      ║')
  console.log('║   → Minimax(compress) → Pro(review)              ║')
  console.log('╚══════════════════════════════════════════════════╝')

  // 1. Classifica primeiro (antes de extrair contexto)
  const complexity = classifyTask(prompt)
  console.log(`[CLASSIFIER] Rota: ${complexity.toUpperCase()}`)

  // 2. Visão (se houver imagem)
  let visionContext = ''
  if (hasImage(prompt, imageBase64) && imageBase64) {
    visionContext = await analyzeImage(imageBase64)
    console.log(`[VISION] Contexto: ${visionContext.length} chars`)
  }

  // 3. Gemini extrai contexto cirúrgico baseado na tarefa e complexidade
  const smartContext = await extractSmartContext(
    visionContext ? `${prompt}\n\nCONTEXTO VISUAL:\n${visionContext}` : prompt,
    context,
    complexity
  )

  // 4. Roteia com contexto otimizado
  let result
  const enrichedPrompt = visionContext
    ? `${prompt}\n\n=== CONTEXTO VISUAL ===\n${visionContext}`
    : prompt

  if (complexity === 'simple') {
    result = await routeSimple(enrichedPrompt, smartContext)
  } else if (complexity === 'premium') {
    result = await routePremium(prompt, smartContext, visionContext)
  } else {
    result = await routeComplex(prompt, smartContext, visionContext)
  }

  result.totalMs = Date.now() - totalStart
  result.visionUsed = !!visionContext
  result.contextReduction = `${fullContext ? Math.round(smartContext.length/context.length*100) : 100}%`

  console.log(`\n[DONE] Rota: ${result.route} | Total: ${result.totalMs}ms | Contexto: ${smartContext.length} chars`)
  return result
}

module.exports = { runPipeline, isPremiumPrompt: (p) => classifyTask(p) === 'premium' }
