import { tool } from "@opencode-ai/plugin"

export function teamSendMessageTool(client: any) {
  return tool({
    description: "Send a message to one or more teammates. Use names, session IDs, or 'lead' as recipient.",
    args: {
      recipient: tool.schema.string().describe("Recipient name, session ID, 'lead', or comma-separated list"),
      body: tool.schema.string().describe("The message body"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { recipient: string; body: string }

      const { getMemberBySession, getActiveTeamForLead, resolveRecipients, sendMessage, getTeamMembers } = await import("../team-service.js")

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
      const recipients = resolveRecipients(params.recipient, members, sessionID, leadSessionID || "")

      if (recipients.length === 0) return "No valid recipients found."

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
              parts: [{
                type: "text",
                text: `<team-messages>\nFrom ${sessionID}:\n${params.body}\n\nUse team_get_messages to read all pending messages.\n</team-messages>`,
              }],
            },
            path: { id: recipientID },
          })
        } catch {
          // Recipient session may not exist or be idle
        }
      }

      return JSON.stringify({ messageID, recipients })
    },
  })
}
