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

  const userPrompt = [
    'You are classifying creative writing (poems, songs, stories). Be CONSERVATIVE.',
    'Only add a tag if the content is EXPLICIT and LITERAL — not metaphorical, not implied.',
    '',
    'SENSITIVE TAGS — only add if the content is unambiguously explicit:',
    '  suicide = text explicitly describes suicide attempts, suicidal ideation, or self-harm as a real act (NOT metaphors for pain, healing, or resilience)',
    '  abuse = text explicitly describes physical, emotional or sexual abuse being inflicted',
    '  violence = text explicitly depicts graphic physical violence or gore',
    '  erotic = text explicitly describes sexual acts, nudity or bdsm',
    '  drugs = text explicitly describes using illegal substances',
    '  trauma = text depicts intense traumatic events (war, assault) in graphic detail',
    '',
    'DESCRIPTIVE TAGS — add when the theme is clearly present:',
    '  love = romantic love, passion, desire',
    '  relationships = friendship, human connection',
    '  nature = landscape, animals, environment',
    '  religion = faith, ritual, prayer',
    '  politics = power, social criticism',
    '  humor = comedy, irony, satire',
    '  family = parenting, ancestry',
    '  loss = grief, mourning, death',
    '  identity = self-discovery, belonging',
    '  fantasy = magic, supernatural',
    '  mystery = suspense, secrets',
    '  social = inequality, society',
    '  spirituality = mysticism, inner journey',
    '',
    'Rules:',
    '- Use ONLY these exact English words as tags, never translate',
    '- Metaphors about pain, healing, or struggle do NOT trigger sensitive tags',
    '- When in doubt about a sensitive tag, leave it out',
    '- Output ONLY a JSON array, no explanation',
    'Example: ["love","spirituality"] or ["loss","nature"] or []',
    '',
    'TEXT:',
    text.slice(0, 2000),
  ].join('\n')

  let raw = ''
  let warnings: string[] = []

  try {
    const result = await c.env.AI.run(
      '@cf/meta/llama-3.2-3b-instruct' as unknown as keyof AiModels,
      {
        messages: [{ role: 'user', content: userPrompt }],
        stream: false,
        max_tokens: 150,
      }
    ) as { response?: string }

    // Suporta dois formatos: { response } (Workers AI simples) e chat completion { choices }
    const resp = result as Record<string, unknown>
    if (typeof resp.response === 'string') {
      raw = resp.response.trim()
    } else {
      type Choice = { message?: { content?: string } }
      const choices = resp.choices as Choice[] | undefined
      raw = choices?.[0]?.message?.content?.trim() ?? JSON.stringify(resp)
    }

    // Tentativa 1: extrair array JSON do texto (suporta aspas simples)
    try {
      const normalized = raw.replace(/'/g, '"')
      const match = normalized.match(/\[[\s\S]*?\]/)
      if (match) {
        const parsed = JSON.parse(match[0]) as unknown[]
        warnings = parsed.filter((t): t is string => VALID_TAGS.includes(t as string))
      }
    } catch { /* segue para fallback */ }

    // Tentativa 2: fallback — extrai qualquer tag válida mencionada no texto
    if (warnings.length === 0) {
      warnings = VALID_TAGS.filter(tag => new RegExp(`\\b${tag}\\b`, 'i').test(raw))
    }
  } catch (err) {
    return c.json({ warnings: [], _debug_raw: '', _error: String(err) }, 200)
  }

  return c.json({ warnings, _debug_raw: raw.slice(0, 300) })
})
