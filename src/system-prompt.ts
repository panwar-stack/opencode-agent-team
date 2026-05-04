import { getActiveTeamForLead, getTeamForMember, getTeamMembers, getTeamTasks, getTeamSummary } from "./team-service.js"

export function systemPromptTransformFn(client: any) {
  return async (input: any, output: any) => {
    const sessionID = input.sessionID
    const agent = input.agent

    const isTeammate = !!(await getTeamForMember(sessionID))
    if (isTeammate) return

    const team = await getActiveTeamForLead(sessionID)

    if (team) {
      const summary = await getTeamSummary(team.id)
      const guidance = `
## Agent Team Orchestration

You are the **lead** of an active agent team.

${summary}

### Lead Responsibilities
- Coordinate and integrate teammate results
- Delegate independent work to teammates using team_spawn
- Do NOT duplicate teammate work — trust their results
- When teammates complete, evaluate if their findings reveal new sub-tasks
- Use team_get_messages to check for teammate updates
- Use team_shutdown when the team goal is complete
- Spawn multiple independent teammates in parallel

### Communication
- Teammates will proactively send updates, progress, handoffs, and blockers
- Check team_get_messages when you want to see what they've sent
- Use team_send_message or team_broadcast to coordinate
`
      output.system = output.system || []
      output.system.push(guidance)
    }
  }
}

export function generateTeammateSystemPrompt(params: {
  name: string
  teamName: string
  teamGoal: string
  leadSessionID: string
  memberSessionID: string
  teamID: string
  rolePrompt: string
  planMode: boolean
  dependencyResults?: string[]
}): string {
  const lines: string[] = []

  lines.push(`You are **${params.name}**, a teammate agent in the team **"${params.teamName}"**.`)
  lines.push(`**Team Goal:** ${params.teamGoal}`)
  lines.push(`**Your Session ID:** ${params.memberSessionID}`)
  lines.push(`**Lead Session ID:** ${params.leadSessionID}`)

  if (params.dependencyResults && params.dependencyResults.length > 0) {
    lines.push(`\n**Results from completed dependency teammates:**`)
    for (const result of params.dependencyResults) {
      lines.push(`- ${result}`)
    }
  }

  lines.push(`\n### Communication`)
  lines.push(`- Send **proactive updates** to the lead using team_send_message when you:`)
  lines.push(`  * Start working on your task (kickoff message)`)
  lines.push(`  * Make meaningful progress`)
  lines.push(`  * Complete your task (handoff message with your final result)`)
  lines.push(`  * Need help or are blocked (blocker message)`)
  lines.push(`- Use team_get_messages to check for messages from the lead`)
  lines.push(`- Use team_broadcast to send updates to all teammates`)

  if (params.planMode) {
    lines.push(`\n### Plan Mode`)
    lines.push(`- You are in **plan mode** — you cannot execute code or edit files`)
    lines.push(`- First create a plan, then submit it for lead approval via team_plan_submit`)
    lines.push(`- Wait for the lead to approve or reject your plan before proceeding`)
  }

  lines.push(`\n### Your Task`)
  lines.push(params.rolePrompt)

  return lines.join("\n")
}
