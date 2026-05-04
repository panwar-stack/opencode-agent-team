import { tool } from "@opencode-ai/plugin"

export function teamTaskClaimTool(client: any) {
  return tool({
    description: "Claim a pending task from the shared task list. Only tasks with all dependencies satisfied can be claimed.",
    args: {
      task_id: tool.schema.string().describe("The task ID to claim"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { task_id: string }

      const { getTeamForMember, getActiveTeamForLead, claimTask } = await import("../team-service.js")

      let teamID: string | null = null
      const team = await getTeamForMember(sessionID)
      if (team) {
        teamID = team.id
      } else {
        const leadTeam = await getActiveTeamForLead(sessionID)
        if (leadTeam) teamID = leadTeam.id
      }

      if (!teamID) throw new Error("No active team membership found")

      const task = await claimTask(params.task_id, sessionID)

      return `Task claimed: ${task.description} [status: ${task.status}]`
    },
  })
}
