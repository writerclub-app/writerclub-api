/// <reference path="../../worker-configuration.d.ts" />
import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'

type Bindings = { DB: D1Database; AI: Ai; JWT_SECRET: string }
type Variables = { authId: string }

export const ai = new Hono<{ Bindings: Bindings; Variables: Variables }>()

type AICommand = 'complete' | 'suggest-rhyme' | 'rewrite' | 'suggest-title' | 'suggest-slug'
type AILanguage = 'pt' | 'en' | 'es' | 'it'

function languageInstruction(language?: AILanguage): string {
  if (language === 'pt') return 'IMPORTANT: You MUST respond ONLY in Brazilian Portuguese (Português do Brasil). Do not use any other language.'
  if (language === 'en') return 'IMPORTANT: You MUST respond ONLY in English. Do not use any other language.'
  if (language === 'es') return 'IMPORTANT: You MUST respond ONLY in Spanish (Español). Do not use any other language.'
  if (language === 'it') return 'IMPORTANT: You MUST respond ONLY in Italian (Italiano). Do not use any other language.'
  return 'Match the exact language(s) of the original text, including any intentional code-switching.'
}

function buildPrompt(command: AICommand, context: string, selection?: string, language?: AILanguage): string {
  const lang = languageInstruction(language)
  const langPrefix = language ? `[LANGUAGE: ${lang}]\n\n` : ''

  switch (command) {
    case 'complete':
      return [
        langPrefix,
        'You are a creative writing assistant. Continue the following text naturally, ',
        'matching the author\'s style and tone. ',
        lang, ' ',
        'Write only the continuation — no preamble, no explanation, no quotes. ',
        'Keep it concise (1–3 sentences or lines).\n\n',
        'Text so far:\n',
        context,
      ].join('')

    case 'rewrite':
      return [
        langPrefix,
        'You are a creative writing assistant. Rewrite the following excerpt, ',
        'preserving the original meaning but improving clarity, flow, or style. ',
        lang, ' ',
        'Return only the rewritten text — no preamble, no explanation, no quotes.\n\n',
        'Excerpt to rewrite:\n',
        selection ?? context,
      ].join('')

    case 'suggest-rhyme':
      return [
        'You are a poetry assistant. Suggest 5 words or short phrases that rhyme with ',
        'the last word or syllable of the following text. ',
        'Match the language of the original text. ',
        'Return only the rhymes, one per line, no numbering, no explanation.\n\n',
        'Text:\n',
        selection ?? context,
      ].join('')

    case 'suggest-title':
      return [
        'You are a creative writing assistant. Suggest a compelling, concise title ',
        'for the following text. Match the language of the original text. ',
        'Return only the title — no quotes, no explanation, no alternatives.\n\n',
        'Text:\n',
        context,
      ].join('')

    case 'suggest-slug':
      return [
        'You are a creative writing assistant. Generate a URL-friendly slug for the ',
        'following text title or content. Use lowercase letters, numbers, and hyphens only. ',
        'No accents, no special characters, no spaces. Keep it short (3–6 words). ',
        'Return only the slug — no explanation.\n\n',
        'Text:\n',
        context,
      ].join('')
  }
}

// POST /ai — run an AI command (authenticated, streaming)
ai.post('/', authMiddleware, async (c) => {
  const body = await c.req.json<{
    command: AICommand
    context: string
    selection?: string
    language?: AILanguage
  }>()

  const { command, context, selection, language } = body

  if (!command || !context) {
    return c.json({ error: 'command and context are required' }, 400)
  }

  const validCommands: AICommand[] = [
    'complete', 'suggest-rhyme', 'rewrite', 'suggest-title', 'suggest-slug',
  ]
  if (!validCommands.includes(command)) {
    return c.json({ error: 'Invalid command' }, 400)
  }

  const prompt = buildPrompt(command, context.slice(0, 4000), selection, language)

  const stream = await c.env.AI.run(
    '@cf/meta/llama-3.2-3b-instruct' as unknown as keyof AiModels,
    {
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      max_tokens: 256,
    }
  )

  return new Response(stream as unknown as ReadableStream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
})

// POST /ai/classify-warnings — classifica avisos de conteúdo (não streaming)
ai.post('/classify-warnings', authMiddleware, async (c) => {
  const body = await c.req.json<{ text: string }>()
  const { text } = body

  if (!text) return c.json({ error: 'text is required' }, 400)

  const VALID_TAGS = [
    'erotic', 'violence', 'suicide', 'drugs', 'trauma', 'abuse',
    'love', 'relationships', 'nature', 'religion', 'politics',
    'humor', 'family', 'loss', 'identity', 'fantasy', 'mystery', 'social', 'spirituality',
  ]

  const systemPrompt = [
    'You are a JSON-only content classifier.',
    'You MUST respond with a single JSON array and nothing else.',
    'No explanation. No preamble. No markdown. Just the JSON array.',
  ].join(' ')

  const userPrompt = [
    'Classify this creative writing text. Return ONLY a JSON array of applicable tags.',
    'Valid tags and meanings:',
    '  erotic = explicit sexual content (sex, bdsm, nudity)',
    '  violence = graphic violence or gore',
    '  suicide = suicide or self-harm as lived experience',
    '  drugs = explicit drug or substance use',
    '  trauma = intense suffering, war, abuse described in detail',
    '  abuse = physical, emotional or sexual abuse',
    '  love = romantic love, passion, desire',
    '  relationships = friendship, family bonds, human connection',
    '  nature = landscape, animals, environment, seasons',
    '  religion = faith, ritual, religious themes',
    '  politics = power, social criticism, activism',
    '  humor = comedy, irony, satire',
    '  family = parenting, siblings, ancestry',
    '  loss = grief, death, absence, mourning',
    '  identity = self-discovery, belonging, gender, culture',
    '  fantasy = magic, mythology, supernatural, worldbuilding',
    '  mystery = suspense, secrets, the unknown',
    '  social = inequality, community, society, class',
    '  spirituality = mysticism, inner journey, transcendence',
    'Pick only tags that clearly apply. Example output: ["erotic","love"] or ["loss"] or [].',
    '',
    'TEXT:',
    text.slice(0, 2000),
  ].join('\n')

  const result = await c.env.AI.run(
    '@cf/meta/llama-3.2-3b-instruct' as unknown as keyof AiModels,
    {
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      stream: false,
      max_tokens: 150,
    }
  ) as { response?: string }

  const raw = (result.response ?? '').trim()
  let warnings: string[] = []

  // Tentativa 1: extrair array JSON do texto (greedy, suporta aspas simples)
  try {
    const normalized = raw.replace(/'/g, '"')
    const match = normalized.match(/\[[\s\S]*?\]/)
    if (match) {
      const parsed = JSON.parse(match[0]) as unknown[]
      warnings = parsed.filter((t): t is string => VALID_TAGS.includes(t as string))
    }
  } catch { /* segue para fallback */ }

  // Tentativa 2: fallback — varrer o texto e extrair qualquer tag válida mencionada
  if (warnings.length === 0) {
    warnings = VALID_TAGS.filter(tag => {
      const pattern = new RegExp(`\\b${tag}\\b`, 'i')
      return pattern.test(raw)
    })
  }

  return c.json({ warnings, _debug_raw: raw.slice(0, 300) })
})
