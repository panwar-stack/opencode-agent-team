// === Core IDs ===
export type TeamID = string
export type MemberID = string
export type TaskID = string
export type MessageID = string

// === Team ===
export interface Team {
  id: TeamID
  name: string
  goal: string
  leadSessionID: string
  status: "active" | "closed" | "cancelled"
  timeCreated: number
  timeUpdated: number
}

// === Team Member ===
export type MemberStatus = "starting" | "blocked" | "active" | "idle" | "completed" | "cancelled"
export type WorkMode = "plan" | "implement"

export interface TeamMember {
  id: MemberID
  teamID: TeamID
  sessionID: string
  name: string
  agentType: string
  model: { providerID: string; modelID: string } | null
  rolePrompt: string
  status: MemberStatus
  planMode: boolean
  workMode: WorkMode
  dependencyIDs: string[] | null
  result: string | null
  timeCreated: number
  timeUpdated: number
}

// === Task ===
export type TaskStatus = "pending" | "in_progress" | "completed" | "cancelled"

export interface TeamTask {
  id: TaskID
  teamID: TeamID
  description: string
  status: TaskStatus
  assignee: string | null
  dependencyIDs: string[] | null
  metadata: Record<string, unknown> | null
  timeCreated: number
  timeUpdated: number
}

// === Message ===
export type DeliveryStatus = "pending" | "delivered" | "read"

export interface TeamMessage {
  id: MessageID
  teamID: TeamID
  sender: string
  recipients: string[]
  body: string
  deliveryStatus: DeliveryStatus
  recipientStatuses: MessageRecipientStatus[]
  timeCreated: number
  timeUpdated: number
}

export interface MessageRecipientStatus {
  id: string
  messageID: MessageID
  teamID: TeamID
  recipient: string
  deliveryStatus: DeliveryStatus
  timeCreated: number
  timeUpdated: number
}

// === Events ===
export type TeamEventType = "team.created" | "team.closed" | "team.member.updated" | "team.message.received"

export interface TeamEvent {
  type: TeamEventType
  properties: Record<string, unknown>
  time: number
}
