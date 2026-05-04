import { tool } from "@opencode-ai/plugin"

export function teamTaskUpdateTool(client: any) {
  return tool({
    description: "Update the status or assignee of a shared team task.",
    args: {
      task_id: tool.schema.string().describe("The task ID"),
      status: tool.schema.enum(["pending", "in_progress", "completed", "cancelled"]).optional().describe("New status"),
      assignee: tool.schema.string().optional().describe("New assignee"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { task_id: string; status?: string; assignee?: string }

      const { getTeamForMember, getActiveTeamForLead, updateTask } = await import("../team-service.js")

      let teamID: string | null = null
      const team = await getTeamForMember(sessionID)
      if (team) {
        teamID = team.id
      } else {
        const leadTeam = await getActiveTeamForLead(sessionID)
        if (leadTeam) teamID = leadTeam.id
      }

      if (!teamID) throw new Error("No active team membership found")

      const status = params.status as "pending" | "in_progress" | "completed" | "cancelled" | undefined
      const result = await updateTask(params.task_id, {
        status,
        assignee: params.assignee,
      })

      return `Task updated: ${result.description} [status: ${result.status}]`
    },
  })
}
