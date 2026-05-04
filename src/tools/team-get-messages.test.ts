const mockGetTeamForMember = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockGetMessagesForRecipient = vi.fn()
const mockMarkAllMessagesDelivered = vi.fn()

vi.mock("../team-service.js", () => ({
  getTeamForMember: mockGetTeamForMember,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  getMessagesForRecipient: mockGetMessagesForRecipient,
}))

vi.mock("../db.js", () => ({
  markAllMessagesDelivered: mockMarkAllMessagesDelivered,
}))

import { teamGetMessagesTool } from "./team-get-messages.js"

function createMockClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({}),
    },
    tui: {
      showToast: vi.fn().mockResolvedValue({}),
    },
  }
}

const context = { sessionID: "member-session-1" }

describe("teamGetMessagesTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it('returns "No active team membership found." when no team exists', async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamGetMessagesTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toBe("No active team membership found.")
  })

  it('returns "No pending messages." on first call with no messages', async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetMessagesForRecipient.mockResolvedValue([])

    const toolDef = teamGetMessagesTool(client)
    const result = await toolDef.execute({}, context)

    expect(result).toBe("No pending messages.")
  })

  it('returns "Polling Blocked" on second call with no messages', async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetMessagesForRecipient.mockResolvedValue([])

    const toolDef = teamGetMessagesTool(client)
    await toolDef.execute({}, context)
    const result = await toolDef.execute({}, context)

    expect(result).toContain("Polling Blocked")
    expect(result).toContain("3 times")
  })

  it("returns formatted messages and marks them delivered", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetMessagesForRecipient.mockResolvedValue([
      { sender: "agent-1", body: "Hello from agent 1" },
      { sender: "agent-2", body: "Hello from agent 2" },
    ])
    mockMarkAllMessagesDelivered.mockResolvedValue(undefined)

    const toolDef = teamGetMessagesTool(client)
    const result = await toolDef.execute({}, { sessionID: "fresh-session" })

    expect(result).toContain("<team-messages>")
    expect(result).toContain("From agent-1:")
    expect(result).toContain("Hello from agent 1")
    expect(result).toContain("From agent-2:")
    expect(result).toContain("Hello from agent 2")
    expect(result).toContain("</team-messages>")
    expect(mockMarkAllMessagesDelivered).toHaveBeenCalledWith("team-1", "fresh-session")
  })

  it("works for lead (via getActiveTeamForLead)", async () => {
    mockGetTeamForMember.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({ id: "team-1", name: "leader", goal: "x", leadSessionID: "lead-1", status: "active" })
    mockGetMessagesForRecipient.mockResolvedValue([
      { sender: "agent-1", body: "Progress report" },
    ])
    mockMarkAllMessagesDelivered.mockResolvedValue(undefined)

    const toolDef = teamGetMessagesTool(client)
    const result = await toolDef.execute({}, { sessionID: "lead-session" })

    expect(result).toContain("Progress report")
  })

  it("works for teammate (via getTeamForMember)", async () => {
    mockGetTeamForMember.mockResolvedValue({ id: "team-2", name: "member-team", goal: "x", leadSessionID: "lead-2", status: "active" })
    mockGetMessagesForRecipient.mockResolvedValue([
      { sender: "lead-session", body: "Approved!" },
    ])

    const toolDef = teamGetMessagesTool(client)
    const result = await toolDef.execute({}, { sessionID: "teammate-session" })

    expect(result).toContain("Approved!")
  })
})
