import type { Team, TeamMember, TeamTask, TeamMessage, MessageRecipientStatus, TeamID, MemberID, TaskID, MessageID, MemberStatus, WorkMode, DeliveryStatus } from "./types.js"
import { generateID, getTeamState, saveTeamState, getTeamByLeadSession, getTeamByMemberSession, getPendingMessages, markMessageDelivered, markAllMessagesDelivered, loadDB, saveDB } from "./db.js"

// === Team Operations ===

export async function createTeam(params: { name: string; goal: string; leadSessionID: string }): Promise<{ teamID: TeamID; name: string; status: string }> {
  const existing = await getTeamByLeadSession(params.leadSessionID)
  if (existing) throw new Error("Active team already exists for this lead session")

  const id = generateID()
  const now = Date.now()
  const team: Team = {
    id,
    name: params.name,
    goal: params.goal,
    leadSessionID: params.leadSessionID,
    status: "active",
    timeCreated: now,
    timeUpdated: now,
  }

  const state = { team, members: [], tasks: [], messages: [] }
  await saveTeamState(state)

  return { teamID: id, name: params.name, status: "active" }
}

export async function getTeam(teamID: TeamID): Promise<Team | null> {
  const state = await getTeamState(teamID)
  return state?.team ?? null
}

export async function getActiveTeamForLead(leadSessionID: string): Promise<Team | null> {
  const state = await getTeamByLeadSession(leadSessionID)
  return state?.team ?? null
}

export async function getTeamForMember(sessionID: string): Promise<Team | null> {
  const state = await getTeamByMemberSession(sessionID)
  return state?.team ?? null
}

export async function shutdownTeam(teamID: TeamID): Promise<void> {
  const state = await getTeamState(teamID)
  if (!state) throw new Error("Team not found")

  state.team.status = "closed"
  state.team.timeUpdated = Date.now()

  for (const member of state.members) {
    if (member.status !== "completed" && member.status !== "cancelled") {
      member.status = "cancelled"
      member.timeUpdated = Date.now()
    }
  }

  await saveTeamState(state)
}

// === Member Operations ===

export async function addMember(params: {
  teamID: TeamID
  sessionID: string
  name: string
  agentType: string
  rolePrompt: string
  planMode: boolean
  workMode: WorkMode
  dependencyIDs: string[] | null
  model: { providerID: string; modelID: string } | null
}): Promise<{ memberID: MemberID; sessionID: string; dependencyIDs: string[] | null }> {
  const state = await getTeamState(params.teamID)
  if (!state) throw new Error("Team not found")

  const id = generateID()
  const now = Date.now()
  const member: TeamMember = {
    id,
    teamID: params.teamID,
    sessionID: params.sessionID,
    name: params.name,
    agentType: params.agentType,
    model: params.model,
    rolePrompt: params.rolePrompt,
    status: "starting",
    planMode: params.planMode,
    workMode: params.workMode,
    dependencyIDs: params.dependencyIDs,
    result: null,
    timeCreated: now,
    timeUpdated: now,
  }

  state.members.push(member)
  await saveTeamState(state)

  return { memberID: id, sessionID: params.sessionID, dependencyIDs: params.dependencyIDs }
}

export async function getMember(memberID: MemberID): Promise<TeamMember | null> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    const member = state.members.find(m => m.id === memberID)
    if (member) return member
  }
  return null
}

export async function getMemberBySession(sessionID: string): Promise<{ member: TeamMember; team: Team } | null> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    const member = state.members.find(m => m.sessionID === sessionID)
    if (member) return { member, team: state.team }
  }
  return null
}

export async function updateMemberStatus(memberID: MemberID, status: MemberStatus, result?: string): Promise<{ member: TeamMember; team: Team } | null> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    const member = state.members.find(m => m.id === memberID)
    if (member) {
      member.status = status
      member.timeUpdated = Date.now()
      if (result !== undefined) member.result = result
      await saveTeamState(state)
      return { member, team: state.team }
    }
  }
  return null
}

export async function isMemberBlocked(member: TeamMember): Promise<boolean> {
  if (!member.dependencyIDs || member.dependencyIDs.length === 0) return false

  const state = await getTeamState(member.teamID)
  if (!state) return true

  for (const depID of member.dependencyIDs) {
    const depMember = state.members.find(m =>
      m.id === depID || m.sessionID === depID || m.name === depID
    )
    if (!depMember) {
      throw new Error(`Unknown dependency "${depID}" for member ${member.name}`)
    }
    if (depMember.status !== "completed" && depMember.status !== "cancelled") {
      return true
    }
  }
  return false
}

export async function setMemberPlanMode(memberID: MemberID, planMode: boolean): Promise<{ member: TeamMember; team: Team } | null> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    const member = state.members.find(m => m.id === memberID)
    if (member) {
      member.planMode = planMode
      member.timeUpdated = Date.now()
      await saveTeamState(state)
      return { member, team: state.team }
    }
  }
  return null
}

export async function getBlockedMembers(teamID: TeamID): Promise<TeamMember[]> {
  const state = await getTeamState(teamID)
  if (!state) return []
  return state.members.filter(m => m.status === "blocked")
}

export async function getTeamMembers(teamID: TeamID): Promise<TeamMember[]> {
  const state = await getTeamState(teamID)
  return state?.members ?? []
}

export async function getTeamMemberNames(teamID: TeamID): Promise<string[]> {
  const state = await getTeamState(teamID)
  return state?.members.map(m => m.name) ?? []
}

// === Message Operations ===

export async function sendMessage(params: {
  teamID: TeamID
  sender: string
  recipients: string[]
  body: string
}): Promise<{ messageID: MessageID }> {
  const state = await getTeamState(params.teamID)
  if (!state) throw new Error("Team not found")

  const id = generateID()
  const now = Date.now()

  const recipientStatuses: MessageRecipientStatus[] = params.recipients.map(r => ({
    id: generateID(),
    messageID: id,
    teamID: params.teamID,
    recipient: r,
    deliveryStatus: "pending" as DeliveryStatus,
    timeCreated: now,
    timeUpdated: now,
  }))

  const message: TeamMessage = {
    id,
    teamID: params.teamID,
    sender: params.sender,
    recipients: params.recipients,
    body: params.body,
    deliveryStatus: "pending",
    recipientStatuses,
    timeCreated: now,
    timeUpdated: now,
  }

  state.messages.push(message)
  await saveTeamState(state)

  return { messageID: id }
}

export async function getMessagesForRecipient(teamID: TeamID, recipient: string): Promise<TeamMessage[]> {
  return getPendingMessages(teamID, recipient)
}

// === Task Operations ===

export async function createTask(params: {
  teamID: TeamID
  description: string
  assignee?: string
  dependencyIDs?: string[]
}): Promise<{ taskID: TaskID }> {
  const state = await getTeamState(params.teamID)
  if (!state) throw new Error("Team not found")

  const id = generateID()
  const now = Date.now()
  const task: TeamTask = {
    id,
    teamID: params.teamID,
    description: params.description,
    status: "pending",
    assignee: params.assignee ?? null,
    dependencyIDs: params.dependencyIDs ?? null,
    metadata: null,
    timeCreated: now,
    timeUpdated: now,
  }

  state.tasks.push(task)
  await saveTeamState(state)

  return { taskID: id }
}

export async function getTeamTasks(teamID: TeamID): Promise<TeamTask[]> {
  const state = await getTeamState(teamID)
  return state?.tasks ?? []
}

export async function claimTask(taskID: TaskID, claimantSessionID: string): Promise<TeamTask> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    const task = state.tasks.find(t => t.id === taskID)
    if (!task) continue

    if (task.status !== "pending") throw new Error("Task is not pending")

    if (task.dependencyIDs) {
      for (const depID of task.dependencyIDs) {
        const depTask = state.tasks.find(t => t.id === depID)
        if (depTask && depTask.status !== "completed" && depTask.status !== "cancelled") {
          throw new Error(`Dependency task ${depID} is not completed`)
        }
      }
    }

    task.status = "in_progress"
    task.assignee = claimantSessionID
    task.timeUpdated = Date.now()
    await saveTeamState(state)
    return task
  }
  throw new Error("Task not found")
}

export async function updateTask(taskID: TaskID, updates: { status?: "pending" | "in_progress" | "completed" | "cancelled"; assignee?: string }): Promise<TeamTask> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    const task = state.tasks.find(t => t.id === taskID)
    if (!task) continue

    if (updates.status) task.status = updates.status
    if (updates.assignee !== undefined) task.assignee = updates.assignee
    task.timeUpdated = Date.now()
    await saveTeamState(state)
    return task
  }
  throw new Error("Task not found")
}

// === Utility ===

export function resolveRecipients(recipient: string, members: TeamMember[], senderSessionID: string, leadSessionID: string): string[] {
  const resolved: Set<string> = new Set()
  const unknown: string[] = []

  const parts = recipient.split(",").map(p => p.trim()).filter(Boolean)

  for (const part of parts) {
    if (part === "lead") {
      resolved.add(leadSessionID)
    } else {
      const member = members.find(m => m.sessionID === part || m.name === part)
      if (member) {
        resolved.add(member.sessionID)
      } else {
        unknown.push(part)
      }
    }
  }

  if (unknown.length > 0) {
    throw new Error(`Unknown recipient(s): ${unknown.join(", ")}. Recipients must be a member name, session ID, or "lead".`)
  }

  resolved.delete(senderSessionID)

  return Array.from(resolved)
}

export async function getTeamSummary(teamID: TeamID): Promise<string> {
  const state = await getTeamState(teamID)
  if (!state) return "No active team"

  const lines: string[] = []
  lines.push(`**Team:** ${state.team.name}`)
  lines.push(`**Goal:** ${state.team.goal}`)
  lines.push(`**Status:** ${state.team.status}`)
  lines.push(`\n**Members:**`)

  for (const m of state.members) {
    const statusIcon = { starting: "🔄", blocked: "⛔", active: "🟢", idle: "💤", completed: "✅", cancelled: "❌" }[m.status]
    lines.push(`  ${statusIcon} **${m.name}** (${m.status}) [${m.agentType}]`)
    if (m.dependencyIDs && m.dependencyIDs.length > 0) {
      const depNames = m.dependencyIDs.map(did => {
        const dm = state.members.find(mm => mm.id === did || mm.sessionID === did || mm.name === did)
        return dm ? dm.name : did
      })
      lines.push(`    depends on: ${depNames.join(", ")}`)
    }
  }

  if (state.tasks.length > 0) {
    lines.push(`\n**Tasks (${state.tasks.filter(t => t.status !== "completed").length} pending):**`)
    for (const t of state.tasks.slice(0, 10)) {
      const statusIcon = { pending: "⬜", in_progress: "🔄", completed: "✅", cancelled: "❌" }[t.status]
      lines.push(`  ${statusIcon} ${t.description}${t.assignee ? ` (assigned: ${t.assignee})` : ""}`)
    }
  }

  return lines.join("\n")
}

export { generateID }
