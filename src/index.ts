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
  shutdownTeam,
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

  let teamEnabled = false
  try {
    const cfgResult = await client.config.get()
    const cfg = cfgResult.data as any
    teamEnabled = cfg?.experimental?.agent_teams === true
  } catch { /* default to false */ }

  if (!teamEnabled) {
    log("info", "Agent teams not enabled (experimental.agent_teams). Returning minimal hooks.")
    return {}
  }

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

    "tool.execute.before": async (input: any) => {
      const sessionID = input.sessionID
      const toolName = input.tool

      const memberResult = await getMemberBySession(sessionID)
      if (!memberResult) return

      if (memberResult.member.planMode && ["bash", "write", "edit", "apply_patch"].includes(toolName)) {
        throw new Error("This tool is not available in plan mode. Submit your plan to the lead for approval first.")
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

      // Gap 6: Handle cancelled sessions
      if (status === "cancelled") {
        await updateMemberStatus(member.id, "cancelled", "Session cancelled")

        if (client.tui?.showToast) {
          client.tui.showToast({ body: { variant: "warning", title: "Team", message: `Teammate ${member.name} was cancelled.` } })
        }

        await sendMessage({
          teamID: team.id,
          sender: sessionID,
          recipients: [team.leadSessionID],
          body: `Teammate **${member.name}** has been cancelled.`,
        })

        try {
          await client.session.prompt({
            body: {
              noReply: true,
              parts: [{
                type: "text",
                text: `<team-messages>\nTeammate **${member.name}** has been cancelled.\n</team-messages>`,
              }],
            },
            path: { id: team.leadSessionID },
          })
        } catch { /* ignore */ }

        const allMembers = await getTeamMembers(team.id)
        const nonLeadMembers = allMembers.filter(m => m.sessionID !== team.leadSessionID)
        const allDone = nonLeadMembers.every(m => m.status === "completed" || m.status === "cancelled")
        if (allDone && nonLeadMembers.length > 0) {
          await shutdownTeam(team.id)
          if (client.tui?.showToast) {
            client.tui.showToast({ body: { variant: "info", title: "Team", message: `Team "${team.name}" shut down — all members finished.` } })
          }
        }

        return
      }

      if (status === "idle" && member.status === "active") {
        await updateMemberStatus(member.id, "idle")
      }

      if (status === "completed" || status === "done") {
        // Gap 2: Result propagation — fetch completed session messages
        let resultText = ""
        try {
          const msgs: any = await client.session.messages({ path: { id: sessionID } })
          const messages = msgs?.data || msgs || []
          if (Array.isArray(messages) && messages.length > 0) {
            const lastMsg = messages[messages.length - 1]
            if (lastMsg?.parts) {
              resultText = lastMsg.parts
                .filter((p: any) => p.type === "text")
                .map((p: any) => p.text)
                .join("\n")
            } else if (lastMsg?.content) {
              resultText = typeof lastMsg.content === "string" ? lastMsg.content : JSON.stringify(lastMsg.content)
            }
          }
        } catch { /* ignore */ }

        await updateMemberStatus(member.id, "completed", resultText || "Session completed")

        // Gap 7: Toast for teammate completion
        if (client.tui?.showToast) {
          client.tui.showToast({ body: { variant: "success", title: "Team", message: `Teammate ${member.name} completed their task.` } })
        }

        await sendMessage({
          teamID: team.id,
          sender: sessionID,
          recipients: [team.leadSessionID],
          body: `Teammate **${member.name}** has completed their task.${resultText ? `\n\n**Result:**\n${resultText}` : ""}`,
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

            if (client.tui?.showToast) {
              client.tui.showToast({ body: { variant: "info", title: "Team", message: `Teammate ${bm.name} is now unblocked.` } })
            }

            await sendMessage({
              teamID: team.id,
              sender: sessionID,
              recipients: [team.leadSessionID],
              body: `Teammate **${bm.name}** is now unblocked and ready. All their dependencies are completed.`,
            })

            const allMembersForDepResults = await getTeamMembers(team.id)
            const depResults: string[] = []
            if (bm.dependencyIDs) {
              for (const depID of bm.dependencyIDs) {
                const depMember = allMembersForDepResults.find(m => m.sessionID === depID || m.name === depID || m.id === depID)
                if (depMember && depMember.status === "completed" && depMember.result) {
                  depResults.push(`**${depMember.name}** completed: ${depMember.result}`)
                }
              }
            }

            const systemPrompt = generateTeammateSystemPrompt({
              name: bm.name,
              teamName: team.name,
              teamGoal: team.goal,
              leadSessionID: team.leadSessionID,
              memberSessionID: bm.sessionID,
              teamID: team.id,
              rolePrompt: bm.rolePrompt,
              planMode: bm.planMode,
              dependencyResults: depResults.length > 0 ? depResults : undefined,
            })

            try {
              await client.session.prompt({
                body: {
                  noReply: true,
                  parts: [{ type: "text", text: `<system>\n${systemPrompt}\n</system>` }],
                },
                path: { id: bm.sessionID },
              })

              await client.session.prompt({
                body: {
                  parts: [{
                    type: "text",
                    text: bm.rolePrompt,
                  }],
                  tools: {
                    task: false,
                    todowrite: true,
                  },
                },
                path: { id: bm.sessionID },
              })
            } catch { /* ignore */ }

            await updateMemberStatus(bm.id, "active")
          }
        }
      }
    },
  }
}

export default AgentTeamPlugin
