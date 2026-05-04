import { tool } from "@opencode-ai/plugin"

export function teamBroadcastTool(client: any) {
  return tool({
    description: "Broadcast a message to all active teammates and the lead (excluding yourself).",
    args: {
      body: tool.schema.string().describe("The broadcast message body"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { body: string }

      const { getMemberBySession, getActiveTeamForLead, sendMessage, getTeamMembers } = await import("../team-service.js")

      let teamID: string | null = null
      let leadSessionID: string | undefined

      const memberInfo = await getMemberBySession(sessionID)
      if (memberInfo) {
        teamID = memberInfo.team.id
        leadSessionID = memberInfo.team.leadSessionID
      } else {
        const team = await getActiveTeamForLead(sessionID)
        if (team) {
          teamID = team.id
          leadSessionID = team.leadSessionID
        }
      }

      if (!teamID) throw new Error("No active team membership found")

      const members = await getTeamMembers(teamID)
      const activeStatuses = ["starting", "blocked", "active", "idle", "completed"]
      const allRecipients = new Set<string>()

      if (leadSessionID && leadSessionID !== sessionID) {
        allRecipients.add(leadSessionID)
      }

      for (const m of members) {
        if (m.sessionID !== sessionID && activeStatuses.includes(m.status)) {
          allRecipients.add(m.sessionID)
        }
      }

      const recipients = Array.from(allRecipients)
      if (recipients.length === 0) return "No recipients to broadcast to."

      const { messageID } = await sendMessage({
        teamID,
        sender: sessionID,
        recipients,
        body: params.body,
      })

      for (const recipientID of recipients) {
        try {
          await client.session.prompt({
            body: {
              noReply: true,
              parts: [{
                type: "text",
                text: `<team-messages>\nYou have pending team mailbox messages. Use team_get_messages to read them.\n</team-messages>`,
              }],
            },
            path: { id: recipientID },
          })
        } catch { /* ignore */ }
      }

      return JSON.stringify({ messageID, recipientCount: recipients.length })
    },
  })
}
