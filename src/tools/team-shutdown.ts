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

      const members = await getTeamMembers(team.id)
      const activeSessionIDs = members
        .filter(m => m.status !== "completed" && m.status !== "cancelled")
        .map(m => m.sessionID)

      await shutdownTeam(team.id)

      for (const sid of activeSessionIDs) {
        try {
          await client.session.delete({ path: { id: sid } })
        } catch {
          // Session may already be gone
        }
      }

      return "Team shut down. All active teammates have been cancelled."
    },
  })
}
