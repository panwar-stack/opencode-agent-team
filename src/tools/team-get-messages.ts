import { tool } from "@opencode-ai/plugin"

const pollingGuards = new Map<string, { count: number; lastCheck: number }>()

export function teamGetMessagesTool(client: any) {
  return tool({
    description: "Read pending team mailbox messages. Returns messages sent to you by other team members.",
    args: {},
    async execute(_args, context) {
      const { sessionID } = context

      const { getTeamForMember, getActiveTeamForLead, getMessagesForRecipient } = await import("../team-service.js")
      const { markAllMessagesDelivered } = await import("../db.js")

      let teamID: string | null = null

      const team = await getTeamForMember(sessionID)
      if (team) {
        teamID = team.id
      } else {
        const leadTeam = await getActiveTeamForLead(sessionID)
        if (leadTeam) teamID = leadTeam.id
      }

      if (!teamID) return "No active team membership found."

      const messages = await getMessagesForRecipient(teamID, sessionID)

      if (messages.length === 0) {
        const guard = pollingGuards.get(sessionID)
        const now = Date.now()
        const isNewTurn = !guard || (now - guard.lastCheck > 10_000)

        if (isNewTurn) {
          pollingGuards.set(sessionID, { count: 1, lastCheck: now })
          return "No pending messages."
        }

        const newCount = guard.count + 1
        pollingGuards.set(sessionID, { count: newCount, lastCheck: now })

        if (guard.count >= 1) {
          return `Polling Blocked: No messages. You've checked ${newCount} times. Wait for teammates to send you messages — they will wake you. Do not call team_get_messages again in this turn.`
        }

        return "No pending messages."
      }

      pollingGuards.delete(sessionID)

      const lines: string[] = ["<team-messages>"]
      for (const msg of messages) {
        lines.push(`From ${msg.sender}:`)
        lines.push(msg.body)
        lines.push("")
      }
      lines.push("</team-messages>")

      await markAllMessagesDelivered(teamID, sessionID)

      return lines.join("\n")
    },
  })
}
