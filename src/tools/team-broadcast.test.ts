const mockGetMemberBySession = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockSendMessage = vi.fn()
const mockGetTeamMembers = vi.fn()

vi.mock("../team-service.js", () => ({
  getMemberBySession: mockGetMemberBySession,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  sendMessage: mockSendMessage,
  getTeamMembers: mockGetTeamMembers,
}))

import { teamBroadcastTool } from "./team-broadcast.js"

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

describe("teamBroadcastTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetMemberBySession.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamBroadcastTool(client)

    await expect(
      toolDef.execute({ body: "Hello all" }, context),
    ).rejects.toThrow("No active team membership found")
  })

  it('returns "No recipients to broadcast to." when only self exists and sender is lead', async () => {
    // As lead, self is the only member, no other members or lead to broadcast to
    mockGetMemberBySession.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "lead-1", name: "lead", status: "active" },
    ])

    const toolDef = teamBroadcastTool(client)
    const result = await toolDef.execute({ body: "Hello all" }, { sessionID: "lead-1" })

    expect(result).toBe("No recipients to broadcast to.")
  })

  it("broadcasts to all active non-self recipients including lead", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "member-session-1", name: "agent", status: "active" },
      { id: "m2", sessionID: "agent-2", name: "agent2", status: "active" },
      { id: "m3", sessionID: "agent-3", name: "agent3", status: "blocked" },
    ])
    mockSendMessage.mockResolvedValue({ messageID: "broadcast-1" })

    const toolDef = teamBroadcastTool(client)
    const result = await toolDef.execute({ body: "Important update" }, context)

    const parsed = JSON.parse(result)
    expect(parsed.messageID).toBe("broadcast-1")
    expect(parsed.recipientCount).toBe(3)

    const sendCall = mockSendMessage.mock.calls[0][0]
    expect(sendCall.body).toBe("Important update")
    expect(sendCall.sender).toBe("member-session-1")
    expect(sendCall.recipients).toContain("lead-1")
    expect(sendCall.recipients).toContain("agent-2")
    expect(sendCall.recipients).toContain("agent-3")
    expect(sendCall.recipients).not.toContain("member-session-1")
  })

  it("skips lead if sender is the lead", async () => {
    mockGetMemberBySession.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m2", sessionID: "agent-2", name: "agent2", status: "active" },
    ])
    mockSendMessage.mockResolvedValue({ messageID: "broadcast-2" })

    const toolDef = teamBroadcastTool(client)
    const result = await toolDef.execute({ body: "Lead broadcast" }, { sessionID: "lead-1" })

    const parsed = JSON.parse(result)
    expect(parsed.recipientCount).toBe(1)

    const sendCall = mockSendMessage.mock.calls[0][0]
    expect(sendCall.recipients).toEqual(["agent-2"])
  })

  it("sends wake-up prompts to each recipient", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m2", sessionID: "agent-2", name: "agent2", status: "active" },
    ])
    mockSendMessage.mockResolvedValue({ messageID: "broadcast-3" })

    const toolDef = teamBroadcastTool(client)
    await toolDef.execute({ body: "Wake up!" }, context)

    expect(client.session.prompt).toHaveBeenCalledTimes(2)
  })

  it("skips non-active member statuses (cancelled)", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m2", sessionID: "agent-2", name: "agent2", status: "cancelled" },
    ])
    mockSendMessage.mockResolvedValue({ messageID: "broadcast-4" })

    const toolDef = teamBroadcastTool(client)
    await toolDef.execute({ body: "Check" }, context)

    const sendCall = mockSendMessage.mock.calls[0][0]
    expect(sendCall.recipients).toEqual(["lead-1"])
  })
})
