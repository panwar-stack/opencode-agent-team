import { tool } from "@opencode-ai/plugin"

export function teamTaskListTool(client: any) {
  return tool({
    description: "List all shared tasks for the current team with statuses.",
    args: {},
    async execute(_args, context) {
      const { sessionID } = context

      const { getTeamForMember, getActiveTeamForLead, getTeamTasks } = await import("../team-service.js")

      let teamID: string | null = null
      const team = await getTeamForMember(sessionID)
      if (team) {
        teamID = team.id
      } else {
        const leadTeam = await getActiveTeamForLead(sessionID)
        if (leadTeam) teamID = leadTeam.id
      }

      if (!teamID) throw new Error("No active team membership found")

      const tasks = await getTeamTasks(teamID)

      if (tasks.length === 0) return "No tasks in this team."

      const lines: string[] = ["## Team Tasks\n"]
      const statusIcons: Record<string, string> = {
        pending: "⬜",
        in_progress: "🔄",
        completed: "✅",
        cancelled: "❌",
      }

      for (const t of tasks) {
        const icon = statusIcons[t.status]
        const assignee = t.assignee ? ` (assigned: ${t.assignee})` : ""
        lines.push(`${icon} **${t.id}**: ${t.description} [${t.status}]${assignee}`)
        if (t.dependencyIDs && t.dependencyIDs.length > 0) {
          lines.push(`  depends on: ${t.dependencyIDs.join(", ")}`)
        }
      }

      return lines.join("\n")
    },
  })
}
