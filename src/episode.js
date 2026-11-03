import { sessionEvents } from './session-events.js'

function truncate(text, limit) {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}…`
}

function blockText(block, { includeReasoning = false } = {}) {
  if (!block || typeof block !== 'object') return ''
  if (block.type === 'text') return String(block.text ?? '')
  if (block.type === 'reasoning') return includeReasoning ? String(block.text ?? '') : ''
  if (block.type === 'image') return '[image]'
  if (block.type === 'tool-call') {
    return `[tool-call ${String(block.name ?? '')} ${String(block.arguments ?? '')}]`
  }
  if (block.type === 'tool-result') {
    const nested = Array.isArray(block.content)
      ? block.content.map((item) => blockText(item)).filter(Boolean).join('\n')
      : ''
    return `[tool-result${block.isError ? ' error' : ''}]${nested ? `\n${nested}` : ''}`
  }
  return ''
}

export function messageText(message, options) {
  if (!message || !Array.isArray(message.content)) return ''
  return message.content
    .map((block) => blockText(block, options))
    .filter(Boolean)
    .join('\n')
    .trim()
}

export function directUserText(message) {
  if (message?.source?.kind !== 'user') return ''
  return messageText(message)
}

function bracketForTurn(events, turn) {
  const start = events.findIndex(
    (event) => event.type === 'turn/start' && event.data?.turn === turn
  )
  if (start < 0) return []
  const relativeEnd = events.slice(start).findIndex(
    (event) => event.type === 'turn/end' && event.data?.turn === turn
  )
  if (relativeEnd < 0) return events.slice(start)
  return events.slice(start, start + relativeEnd + 1)
}

/** Build the reward-less episode staged at turn/end. */
export function buildEpisodeDraft({ session, turn, query, maxEpisodeChars }) {
  const events = bracketForTurn(sessionEvents(session), turn)
  const contextMessages = []
  const assistantOutputs = []
  const toolObservations = []
  let turnReason = { kind: 'unknown' }

  for (const event of events) {
    if (event.type === 'user/message' && event.data?.source?.kind === 'user') {
      const content = messageText(event.data)
      if (content) contextMessages.push({ role: 'user', content })
      continue
    }
    if (event.type === 'assistant/message') {
      const content = messageText(event.data?.message)
      if (content) {
        contextMessages.push({ role: 'assistant', content })
        assistantOutputs.push(content)
      }
      continue
    }
    if (event.type === 'tool/result') {
      const content = messageText(event.data?.message)
      const observation = {
        role: 'tool',
        content,
        ...(event.data?.error ? { error: event.data.error } : {})
      }
      contextMessages.push(observation)
      toolObservations.push(observation)
      continue
    }
    if (event.type === 'turn/end') turnReason = event.data?.reason ?? turnReason
  }

  const finalOutput = assistantOutputs.at(-1) ?? ''
  const observation = JSON.stringify({
    turn_reason: turnReason,
    tool_results: toolObservations
  })

  // Bound each field independently, then bound the aggregate context. This
  // avoids accidentally uploading images, reasoning traces, or an unbounded log.
  const boundedContext = []
  let remaining = maxEpisodeChars
  for (const message of contextMessages) {
    if (remaining <= 0) break
    const content = truncate(String(message.content ?? ''), remaining)
    boundedContext.push({ ...message, content })
    remaining -= content.length
  }

  return {
    episode_key: `${session.id}:${turn}`,
    episode_index: turn,
    query: truncate(String(query), maxEpisodeChars),
    context_messages: boundedContext,
    agent_final_output: truncate(finalOutput, maxEpisodeChars),
    observation: truncate(observation, maxEpisodeChars)
  }
}
