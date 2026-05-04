import { getMessagesForRecipient } from "./team-service.js"
import { markAllMessagesDelivered } from "./db.js"
import type { TeamMessage } from "./types.js"

export async function deliverTeamMessages(
  sessionID: string,
  teamID: string,
  client: any
): Promise<TeamMessage[]> {
  const messages = await getMessagesForRecipient(teamID, sessionID)

  if (messages.length === 0) return []

  const lines: string[] = [
    "<team-messages>",
    "You have pending team mailbox messages. As the recipient, address the content, and continue working.",
  ]

  for (const msg of messages) {
    const senderLabel = msg.sender === sessionID ? "You" : `From teammate (${msg.sender})`
    lines.push("")
    lines.push(`${senderLabel}:`)
    lines.push(msg.body)
  }

  lines.push("</team-messages>")

  try {
    await client.session.prompt({
      body: {
        noReply: true,
        parts: [{ type: "text", text: lines.join("\n") }],
      },
      path: { id: sessionID },
    })
  } catch (e) {
    console.error("Failed to inject team messages:", e)
  }

  await markAllMessagesDelivered(teamID, sessionID)

  return messages
}

export function createAntiPollingGuard() {
  let emptyCalls = 0

  return {
    check(): string | null {
      emptyCalls++
      if (emptyCalls > 1) {
        return `Polling Blocked: You've already checked team_get_messages ${emptyCalls} times this turn with no results. Wait for teammates to send you messages — they will wake you. Do not call team_get_messages again.`
      }
      return null
    },
    reset(): void {
      emptyCalls = 0
    },
  }
}
