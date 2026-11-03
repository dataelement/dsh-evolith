import { directUserText, messageText } from './episode.js'
import { receiptTraceText, MEMORY_MESSAGE_SOURCE_KIND, READ_RECEIPT_MARKER_SOURCE } from './receipt-marker.js'
import { sessionEvents } from './session-events.js'

function bounded(text, limit) {
  const value = String(text ?? '')
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/**
 * Rebuild the human-visible Session transcript without reasoning blocks or
 * synthetic user-role context. Message positions in this filtered transcript
 * are the positions sent to the weak-supervision service.
 */
export function transcriptFromEvents(events, maxMessageChars = 50_000, receiptScope) {
  const messages = []
  const firstAssistantIndexByTurn = new Map()

  for (const event of events ?? []) {
    if (event.type === 'user/message') {
      const source = event.data?.source
      const memorySource = source?.kind === MEMORY_MESSAGE_SOURCE_KIND || (source?.kind === 'plugin' && source.plugin === READ_RECEIPT_MARKER_SOURCE)
      if (receiptScope && memorySource && source.memoryTargetScope !== receiptScope) continue
      const receiptText = receiptTraceText(event.data, messageText)
      if (receiptText) {
        messages.push({
          role: 'system',
          content: receiptText,
          metadata: {
            source: 'dsh-memory-bridge',
            kind: 'memory_read_receipt'
          }
        })
        continue
      }
      const content = directUserText(event.data)
      if (content) messages.push({ role: 'user', content: bounded(content, maxMessageChars) })
      continue
    }
    if (event.type === 'assistant/message') {
      const content = messageText(event.data?.message)
      if (!content) continue
      const index = messages.length
      messages.push({ role: 'assistant', content: bounded(content, maxMessageChars) })
      const turn = event.data?.turn
      if (Number.isSafeInteger(turn) && !firstAssistantIndexByTurn.has(turn)) {
        firstAssistantIndexByTurn.set(turn, index)
      }
      continue
    }
    if (event.type === 'tool/result') {
      const content = messageText(event.data?.message)
      if (content) messages.push({ role: 'tool', content: bounded(content, maxMessageChars) })
    }
  }

  return { messages, firstAssistantIndexByTurn }
}

/** Build the exact service request; receipt attribution lives inside trace messages. */
export function buildWeakSupervisionRequest({
  session,
  username,
  maxMessageChars,
  receiptScope
}) {
  const { messages } = transcriptFromEvents(
    sessionEvents(session),
    maxMessageChars,
    receiptScope
  )
  return {
    session_id: String(session.id),
    username,
    messages
  }
}
