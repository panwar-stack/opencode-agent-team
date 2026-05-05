import { tool } from "@opencode-ai/plugin"

export function teamPlanDecideTool(client: any) {
  return tool({
    description: "Approve or reject a teammate's submitted plan. Only the team lead can use this.",
    args: {
      member_name: tool.schema.string().describe("The name of the teammate who submitted the plan"),
      decision: tool.schema.enum(["approve", "reject"]).describe("Decision on the plan"),
      feedback: tool.schema.string().optional().describe("Feedback for rejection or guidance"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { member_name: string; decision: string; feedback?: string }

      const { getActiveTeamForLead, getTeamMembers, updateMemberStatus, setMemberPlanMode, sendMessage } = await import("../team-service.js")

      const team = await getActiveTeamForLead(sessionID)
      if (!team) throw new Error("No active team found. Only the team lead can approve/reject plans.")

      const members = await getTeamMembers(team.id)
      const member = members.find(m => m.name === params.member_name)
      if (!member) throw new Error(`No teammate found with name "${params.member_name}"`)

      if (params.decision === "approve") {
        await updateMemberStatus(member.id, "starting")
        await setMemberPlanMode(member.id, false)

        try {
          const memberSession = await client.session.get({ path: { id: member.sessionID } })
          const currentPerms = memberSession?.data?.permission
          if (Array.isArray(currentPerms)) {
            const newPerms = currentPerms.filter(
              (rule: any) => !(
                rule.action === "deny" &&
                rule.pattern === "*" &&
                ["edit", "write", "bash", "apply_patch"].includes(rule.permission)
              )
            )
            await client.session.update({
              body: { permission: newPerms },
              path: { id: member.sessionID },
            })
          }
        } catch { /* ignore if unavailable */ }

        await sendMessage({
          teamID: team.id,
          sender: sessionID,
          recipients: [member.sessionID],
          body: `## Plan Approved ✅\n${params.feedback ? `\nFeedback: ${params.feedback}` : ""}\n\nYou are now in implementation mode. Proceed with your plan.`,
        })

        try {
          await client.session.prompt({
            body: {
              parts: [{
                type: "text",
                text: `Your plan was approved! ${params.feedback ? `Feedback: ${params.feedback}` : ""} You may now proceed with implementation.`,
              }],
              tools: { task: false, todowrite: true },
            },
            path: { id: member.sessionID },
          })
        } catch { /* ignore */ }

        return `Plan from ${params.member_name} approved. Teammate notified.`

      } else {
        await sendMessage({
          teamID: team.id,
          sender: sessionID,
          recipients: [member.sessionID],
          body: `## Plan Rejected ❌\n${params.feedback ? `\nFeedback: ${params.feedback}` : ""}\n\nRevise your plan and re-submit.`,
        })

        try {
          await client.session.prompt({
            body: {
              parts: [{
                type: "text",
                text: `Your plan was rejected by the lead. ${params.feedback ? `Feedback: ${params.feedback}` : ""} Revise your plan and re-submit via team_plan_submit.`,
              }],
              tools: { task: false, todowrite: true },
            },
            path: { id: member.sessionID },
          })
        } catch { /* ignore */ }

        return `Plan from ${params.member_name} rejected. Feedback sent.`
      }
    },
  })
}
