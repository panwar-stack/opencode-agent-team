import { tool } from "@opencode-ai/plugin"

export function teamPlanSubmitTool(client: any) {
  return tool({
    description: "Submit a proposed plan to the lead for approval. Only works in plan mode.",
    args: {
      plan: tool.schema.string().describe("The plan content to submit for approval"),
    },
    async execute(args, context) {
      const { sessionID } = context
      const params = args as { plan: string }

      const { getMemberBySession, sendMessage } = await import("../team-service.js")

      const memberInfo = await getMemberBySession(sessionID)
      if (!memberInfo) throw new Error("No active team membership found")
      if (!memberInfo.member.planMode) throw new Error("You are not in plan mode. This tool is only available for plan-mode teammates.")

      const team = memberInfo.team

      await sendMessage({
        teamID: team.id,
        sender: sessionID,
        recipients: [team.leadSessionID],
        body: `## Plan from ${memberInfo.member.name}\n\n${params.plan}\n\nUse team_plan_decide to approve or reject this plan.`,
      })

      try {
        await client.session.prompt({
          body: {
            noReply: true,
            parts: [{
              type: "text",
              text: `<team-messages>\nA teammate (${memberInfo.member.name}) has submitted a plan for your review. Use team_plan_decide to approve or reject it.\n</team-messages>`,
            }],
          },
          path: { id: team.leadSessionID },
        })
      } catch { /* ignore */ }

      return "Plan submitted. Waiting for lead approval."
    },
  })
}
