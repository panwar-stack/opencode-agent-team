import { tool } from "@opencode-ai/plugin"

export function teamTaskCreateTool(client: any) {
  return tool({
    description: "Create a new shared task in the team's task list for work tracking.",
    args: {
      description: tool.schema.string().describe("Task description"),
      assignee: tool.schema.string().optional().describe("Optional assignee name/session ID"),
      dependency_ids: tool.schema.array(tool.schema.string()).optional().describe("IDs of tasks this depends on"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { description: string; assignee?: string; dependency_ids?: string[] }

      const { getTeamForMember, getActiveTeamForLead, createTask } = await import("../team-service.js")

      let teamID: string | null = null
      const team = await getTeamForMember(sessionID)
      if (team) {
        teamID = team.id
      } else {
        const leadTeam = await getActiveTeamForLead(sessionID)
        if (leadTeam) teamID = leadTeam.id
      }

      if (!teamID) throw new Error("No active team membership found")

      const { taskID } = await createTask({
        teamID,
        description: params.description,
        assignee: params.assignee,
        dependencyIDs: params.dependency_ids,
      })

      return JSON.stringify({ taskID })
    },
  })
}
