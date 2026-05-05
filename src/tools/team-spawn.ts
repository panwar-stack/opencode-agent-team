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

        // Inherit permissions from lead session - upstream uses flat array
        let permissions: any[] = []
        try {
          const leadSession = await client.session.get({ path: { id: sessionID } })
          const leadPerms = leadSession?.data?.permission
          if (Array.isArray(leadPerms)) {
            // Keep external_directory and existing deny rules
            permissions = leadPerms.filter(
              (rule: any) => rule.permission === "external_directory" || rule.action === "deny"
            )
          }
        } catch (_e) { /* ignore if unavailable */ }

        // For plan-mode, deny write/execute tools (flat array format like upstream)
        if (planMode) {
          permissions.push(
            { permission: "bash", pattern: "*", action: "deny" },
            { permission: "write", pattern: "*", action: "deny" },
            { permission: "edit", pattern: "*", action: "deny" },
            { permission: "apply_patch", pattern: "*", action: "deny" },
          )
        }

        if (permissions.length > 0) {
          body.permission = permissions
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

      // Mark active immediately - teammate runs asynchronously in background
      const { updateMemberStatus: us } = await import("../team-service.js")
      await us(memberID, "active")

      // Fire-and-forget: combine system and role prompt into a single prompt call
      client.session.prompt({
        body: {
          agent: params.agent_type,
          parts: [
            { type: "text", text: `<system>\n${systemPrompt}\n</system>` },
            { type: "text", text: params.role_prompt },
          ],
          tools: {
            task: false,
            todowrite: true,
          },
        },
        path: { id: childSessionID },
      }).catch(async (e: Error) => {
        const { updateMemberStatus: us2 } = await import("../team-service.js")
        await us2(memberID, "cancelled", `Failed to start teammate: ${e.message}`)
      })

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
