import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { homedir } from "node:os"
import type { Team, TeamMember, TeamTask, TeamMessage, TeamID } from "./types.js"

const DATA_DIR = join(homedir(), ".local", "share", "opencode", "agent-team")
const TEAMS_FILE = join(DATA_DIR, "teams.json")

interface TeamState {
  team: Team
  members: TeamMember[]
  tasks: TeamTask[]
  messages: TeamMessage[]
}

interface DB {
  teams: Record<TeamID, TeamState>
}

async function loadDB(): Promise<DB> {
  try {
    const data = await readFile(TEAMS_FILE, "utf-8")
    return JSON.parse(data)
  } catch {
    return { teams: {} }
  }
}

async function saveDB(db: DB): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(TEAMS_FILE, JSON.stringify(db, null, 2))
}

async function getTeamState(teamID: TeamID): Promise<TeamState | null> {
  const db = await loadDB()
  return db.teams[teamID] ?? null
}

async function saveTeamState(state: TeamState): Promise<void> {
  const db = await loadDB()
  db.teams[state.team.id] = state
  await saveDB(db)
}

async function getTeamByLeadSession(leadSessionID: string): Promise<TeamState | null> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    if (state.team.leadSessionID === leadSessionID && state.team.status === "active") {
      return state
    }
  }
  return null
}

async function getTeamByMemberSession(sessionID: string): Promise<TeamState | null> {
  const db = await loadDB()
  for (const state of Object.values(db.teams)) {
    if (state.members.some(m => m.sessionID === sessionID && m.status !== "cancelled")) {
      return state
    }
  }
  return null
}

async function getPendingMessages(teamID: TeamID, recipient: string): Promise<TeamMessage[]> {
  const state = await getTeamState(teamID)
  if (!state) return []
  return state.messages.filter(m =>
    m.recipientStatuses.some(rs =>
      rs.recipient === recipient && rs.deliveryStatus === "pending"
    )
  )
}

async function markMessageDelivered(teamID: TeamID, messageID: string, recipient: string): Promise<void> {
  const state = await getTeamState(teamID)
  if (!state) return

  const msg = state.messages.find(m => m.id === messageID)
  if (!msg) return

  const rs = msg.recipientStatuses.find(r => r.recipient === recipient)
  if (rs) {
    rs.deliveryStatus = "delivered"
    rs.timeUpdated = Date.now()
  }

  if (msg.recipientStatuses.every(r => r.deliveryStatus === "delivered" || r.deliveryStatus === "read")) {
    msg.deliveryStatus = "delivered"
  }

  msg.timeUpdated = Date.now()
  await saveTeamState(state)
}

async function markAllMessagesDelivered(teamID: TeamID, recipient: string): Promise<void> {
  const state = await getTeamState(teamID)
  if (!state) return

  for (const msg of state.messages) {
    const rs = msg.recipientStatuses.find(r => r.recipient === recipient)
    if (rs && rs.deliveryStatus === "pending") {
      rs.deliveryStatus = "delivered"
      rs.timeUpdated = Date.now()
    }
    if (msg.recipientStatuses.every(r => r.deliveryStatus !== "pending")) {
      msg.deliveryStatus = "delivered"
    }
    msg.timeUpdated = Date.now()
  }

  await saveTeamState(state)
}

function generateID(): string {
  return crypto.randomUUID()
}

export {
  DATA_DIR,
  loadDB,
  saveDB,
  getTeamState,
  saveTeamState,
  getTeamByLeadSession,
  getTeamByMemberSession,
  getPendingMessages,
  markMessageDelivered,
  markAllMessagesDelivered,
  generateID,
}

export type { DB, TeamState }
