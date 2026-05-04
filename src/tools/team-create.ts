import { tool } from "@opencode-ai/plugin"

export function teamCreateTool(client: any) {
  return tool({
    description: "Create a multi-agent team for the current session. Only one active team per lead session.",
    args: {
      name: tool.schema.string().describe("Short name for the team"),
      goal: tool.schema.string().describe("The team's overall goal or mission"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const { name, goal } = args as { name: string; goal: string }

      const { createTeam } = await import("../team-service.js")
      const result = await createTeam({ name, goal, leadSessionID: sessionID })

      return JSON.stringify({ teamID: result.teamID, name: result.name, status: result.status })
    },
  })
}
