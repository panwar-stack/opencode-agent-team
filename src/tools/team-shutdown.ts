import { tool } from "@opencode-ai/plugin"

export function teamShutdownTool(client: any) {
  return tool({
    description: "Shut down the active team, cancelling all active teammate sessions and marking the team as closed.",
    args: {},
    async execute(_args, context) {
      const { sessionID } = context

      const { getActiveTeamForLead, shutdownTeam, getTeamMembers } = await import("../team-service.js")
      const team = await getActiveTeamForLead(sessionID)
      if (!team) throw new Error("No active team found for this session")

      await shutdownTeam(team.id)

      const members = await getTeamMembers(team.id)
      for (const m of members) {
        if (m.status !== "completed" && m.status !== "cancelled") {
          try {
            await client.session.delete({ path: { id: m.sessionID } })
          } catch {
            // Session may already be gone
          }
        }
      }

      return "Team shut down. All active teammates have been cancelled."
    },
  })
}
