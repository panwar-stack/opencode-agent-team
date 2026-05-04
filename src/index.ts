import type { Plugin } from "@opencode-ai/plugin"

import { teamCreateTool } from "./tools/team-create.js"
import { teamSpawnTool } from "./tools/team-spawn.js"
import { teamGetMessagesTool } from "./tools/team-get-messages.js"
import { teamSendMessageTool } from "./tools/team-send-message.js"
import { teamBroadcastTool } from "./tools/team-broadcast.js"
import { teamShutdownTool } from "./tools/team-shutdown.js"
import { teamTaskCreateTool } from "./tools/team-task-create.js"
import { teamTaskListTool } from "./tools/team-task-list.js"
import { teamTaskClaimTool } from "./tools/team-task-claim.js"
import { teamTaskUpdateTool } from "./tools/team-task-update.js"
import { teamPlanSubmitTool } from "./tools/team-plan-submit.js"
import { teamPlanDecideTool } from "./tools/team-plan-decide.js"

import type { TeamEvent } from "./types.js"
import {
  getActiveTeamForLead,
  getTeamForMember,
  getMemberBySession,
  updateMemberStatus,
  getTeamMembers,
  getBlockedMembers,
  isMemberBlocked,
  sendMessage,
  getTeamSummary,
} from "./team-service.js"
import { deliverTeamMessages } from "./message-delivery.js"
import { generateTeammateSystemPrompt } from "./system-prompt.js"

export const AgentTeamPlugin: Plugin = async ({ project, client, directory, $ }) => {
  const log = (level: string, message: string) => {
    try {
      client.app.log({ body: { service: "agent-team", level: level as "info" | "debug" | "error" | "warn", message } })
    } catch {
      console.log(`[agent-team:${level}] ${message}`)
    }
  }

  log("info", "Agent team plugin initialized")

  return {
    tool: {
      team_create: teamCreateTool(client),
      team_spawn: teamSpawnTool(client),
      team_get_messages: teamGetMessagesTool(client),
      team_send_message: teamSendMessageTool(client),
      team_broadcast: teamBroadcastTool(client),
      team_shutdown: teamShutdownTool(client),
      team_task_create: teamTaskCreateTool(client),
      team_task_list: teamTaskListTool(client),
      team_task_claim: teamTaskClaimTool(client),
      team_task_update: teamTaskUpdateTool(client),
      team_plan_submit: teamPlanSubmitTool(client),
      team_plan_decide: teamPlanDecideTool(client),
    },

    "experimental.chat.system.transform": async (input: any, output: any) => {
      const sessionID = input.sessionID

      const isTeammate = !!(await getTeamForMember(sessionID))
      if (isTeammate) return

      const team = await getActiveTeamForLead(sessionID)
      if (team) {
        const summary = await getTeamSummary(team.id)

        const guidance = `
## Active Agent Team

You are the **lead** of an active agent team.

${summary}

### Lead Responsibilities
- **Delegate first, implement last.** Before doing any work yourself, ask: can this be split and handed off to teammates?
- **Trust teammate results** — do not redo or duplicate their work.
- **Coordinate and integrate** — your job is to make decisions, resolve conflicts, and produce the final result.
- **Decompose continuously** — as teammates return results, identify new sub-tasks and delegate those too.
- **Use team_spawn** to create teammates. Use \`depends_on\` for ordering.
- **Spawn multiple independent teammates in parallel** whenever possible.
- Teammates will proactively send updates — use \`team_get_messages\` to check.
- Use \`team_shutdown\` when the team goal is complete.

### Available Team Tools
- \`team_spawn\` — Spawn a new teammate (parallel execution when independent)
- \`team_get_messages\` — Read messages from teammates
- \`team_send_message\` — Send a message to a specific teammate
- \`team_broadcast\` — Broadcast to all teammates
- \`team_task_create\` — Create a shared task
- \`team_task_list\` — List shared tasks
- \`team_task_claim\` — Claim a task (no effect, just tracking)
- \`team_task_update\` — Update task status
- \`team_plan_submit\` — Submit a plan for lead approval (plan-mode teammates only)
- \`team_plan_decide\` — Approve or reject a teammate's plan
- \`team_shutdown\` — Shut down the team
`
        output.system = output.system || []
        output.system.push(guidance)
      }
    },

    "experimental.session.compacting": async (input: any, output: any) => {
      const sessionID = input.sessionID

      const memberResult = await getMemberBySession(sessionID)
      if (memberResult) {
        output.context = output.context || []
        output.context.push(
          `You are teammate "${memberResult.member.name}" in team "${memberResult.team.name}". ` +
          `Status: ${memberResult.member.status}. Goal: ${memberResult.team.goal}. ` +
          `Your assigned task: ${memberResult.member.rolePrompt}`
        )
        return
      }

      const team = await getActiveTeamForLead(sessionID)
      if (team) {
        const summary = await getTeamSummary(team.id)
        output.context = output.context || []
        output.context.push(
          `You are the lead of team "${team.name}". Goal: ${team.goal}. Current summary:\n${summary}`
        )
      }
    },

    event: async ({ event }: { event: any }) => {
      if (event.type !== "session.status") return

      const sessionID = event.properties?.session?.id
      const status = event.properties?.status
      if (!sessionID || !status) return

      const memberResult = await getMemberBySession(sessionID)
      if (!memberResult) return

      const team = memberResult.team
      const member = memberResult.member

      if (status === "idle" && member.status === "active") {
        await updateMemberStatus(member.id, "idle")
      }

      if (status === "completed" || status === "done") {
        await updateMemberStatus(member.id, "completed", "Session completed")

        await sendMessage({
          teamID: team.id,
          sender: sessionID,
          recipients: [team.leadSessionID],
          body: `Teammate **${member.name}** has completed their task.`,
        })

        try {
          await client.session.prompt({
            body: {
              noReply: true,
              parts: [{
                type: "text",
                text: `<team-messages>\nTeammate **${member.name}** has completed their work. Check their output and decide next steps.\n</team-messages>`,
              }],
            },
            path: { id: team.leadSessionID },
          })
        } catch { /* ignore */ }

        const blockedMembers = await getBlockedMembers(team.id)
        for (const bm of blockedMembers) {
          const stillBlocked = await isMemberBlocked(bm)
          if (!stillBlocked) {
            await updateMemberStatus(bm.id, "starting")

            await sendMessage({
              teamID: team.id,
              sender: sessionID,
              recipients: [team.leadSessionID],
              body: `Teammate **${bm.name}** is now unblocked and ready. All their dependencies are completed.`,
            })
          }
        }
      }
    },
  }
}

export default AgentTeamPlugin
