import { tool } from "@opencode-ai/plugin"

export function teamSpawnTool(client: any) {
  return tool({
    description: "Spawn a new teammate agent in a background child session. Use for delegating independent work in parallel.",
    args: {
      name: tool.schema.string().describe("Display name for this teammate"),
      agent_type: tool.schema.string().describe("The type of agent to use (e.g. 'general', 'explore')"),
      role_prompt: tool.schema.string().describe("Detailed task description for the teammate"),
      depends_on: tool.schema.array(tool.schema.string()).optional().describe("Names/session IDs of teammates that must complete first"),
      wait_for: tool.schema.array(tool.schema.string()).optional().describe("Alias for depends_on"),
      plan_mode: tool.schema.boolean().optional().describe("Start in plan mode requiring lead approval before implementation"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as {
        name: string
        agent_type: string
        role_prompt: string
        depends_on?: string[]
        wait_for?: string[]
        plan_mode?: boolean
      }

      const { getActiveTeamForLead, addMember, isMemberBlocked, getTeamMembers } = await import("../team-service.js")
      const { getTeamState } = await import("../db.js")
      const { generateTeammateSystemPrompt } = await import("../system-prompt.js")

      const team = await getActiveTeamForLead(sessionID)
      if (!team) throw new Error("No active team found. Create a team first with team_create.")

      const planMode = params.plan_mode ?? false
      const dependencyIDs = (() => {
        const both = [...(params.depends_on || []), ...(params.wait_for || [])]
        return both.length > 0 ? [...new Set(both)] : null
      })()

      if (dependencyIDs) {
        const members = await getTeamMembers(team.id)
        for (const depID of dependencyIDs) {
          const match = members.find(m => m.sessionID === depID || m.name === depID || m.id === depID)
          if (!match) {
            throw new Error(`Unknown dependency: "${depID}" — no teammate member matches this name, session ID, or member ID`)
          }
        }
      }

      let childSession: any
      try {
        const body: any = {
          title: `${params.name} (${params.agent_type})`,
          parentID: sessionID,
          agent: params.agent_type,
        }

        // Inherit permissions from lead session
        try {
          const leadSession = await client.session.get({ path: { id: sessionID } })
          if (leadSession?.data?.permission) {
            body.permission = leadSession.data.permission
          }
        } catch (_e) { /* ignore if unavailable */ }

        // For plan-mode, deny write/execute tools
        if (planMode) {
          body.permission = {
            ...(body.permission || {}),
            deny: [
              ...(body.permission?.deny || []),
              { ruleset: "*", permission: "bash", action: "deny" },
              { ruleset: "*", permission: "write", action: "deny" },
              { ruleset: "*", permission: "edit", action: "deny" },
              { ruleset: "*", permission: "apply_patch", action: "deny" },
            ],
          }
        }

        childSession = await client.session.create({ body })
      } catch (e) {
        throw new Error(`Failed to create child session: ${(e as Error).message}`)
      }

      const childSessionID = childSession.data?.id || childSession.id
      if (!childSessionID) throw new Error("Failed to get child session ID")

      const members = await getTeamMembers(team.id)
      const depResults: string[] = []

      if (dependencyIDs) {
        for (const depID of dependencyIDs) {
          const depMember = members.find(m => m.sessionID === depID || m.name === depID || m.id === depID)
          if (depMember && depMember.status === "completed" && depMember.result) {
            depResults.push(`**${depMember.name}** completed: ${depMember.result}`)
          }
        }
      }

      const { memberID } = await addMember({
        teamID: team.id,
        sessionID: childSessionID,
        name: params.name,
        agentType: params.agent_type,
        rolePrompt: params.role_prompt,
        planMode,
        workMode: planMode ? "plan" : "implement",
        dependencyIDs,
        model: null,
      })

      const systemPrompt = generateTeammateSystemPrompt({
        name: params.name,
        teamName: team.name,
        teamGoal: team.goal,
        leadSessionID: sessionID,
        memberSessionID: childSessionID,
        teamID: team.id,
        rolePrompt: params.role_prompt,
        planMode,
        dependencyResults: depResults.length > 0 ? depResults : undefined,
      })

      const state = await getTeamState(team.id)
      const member = state?.members.find(m => m.id === memberID)
      if (!member) throw new Error("Failed to find created member")

      const blocked = await isMemberBlocked(member)

      if (blocked) {
        await (await import("../team-service.js")).updateMemberStatus(memberID, "blocked")
        return JSON.stringify({
          memberID,
          sessionID: childSessionID,
          dependencyIDs,
          status: "blocked",
          message: "Teammate blocked — waiting for dependencies to complete",
        })
      }

      try {
        await client.session.prompt({
          body: {
            noReply: true,
            parts: [{ type: "text", text: `<system>\n${systemPrompt}\n</system>` }],
          },
          path: { id: childSessionID },
        })

        await client.session.prompt({
          body: {
            parts: [{
              type: "text",
              text: params.role_prompt,
            }],
            tools: {
              task: false,
              todowrite: true,
            },
          },
          path: { id: childSessionID },
        })
      } catch (e) {
        await (await import("../team-service.js")).updateMemberStatus(memberID, "cancelled", (e as Error).message)
        throw new Error(`Failed to start teammate: ${(e as Error).message}`)
      }

      await (await import("../team-service.js")).updateMemberStatus(memberID, "active")

      return JSON.stringify({
        memberID,
        sessionID: childSessionID,
        dependencyIDs,
        status: "active",
        message: "Teammate spawned successfully",
      })
    },
  })
}
