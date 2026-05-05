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

      // Shutdown first to mark team closed and members cancelled
      await shutdownTeam(team.id)

      // Cancel active runs and delete sessions in parallel (upstream uses Effect.forEach concurrent)
      const cancelOps = activeSessionIDs.map(async (sid) => {
        try {
          // Cancel the session first (stop any active agent run)
          if (typeof client.session.cancel === "function") {
            await client.session.cancel({ path: { id: sid } })
          }
        } catch {
          // Cancel may not be supported or session may already be gone
        }
        try {
          // Delete the session
          await client.session.delete({ path: { id: sid } })
        } catch {
          // Session may already be gone
        }
      })

      await Promise.all(cancelOps)

      return "Team shut down. All active teammates have been cancelled."
    },
  })
}
