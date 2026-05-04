const mockGetMemberBySession = vi.fn()
const mockGetActiveTeamForLead = vi.fn()
const mockResolveRecipients = vi.fn()
const mockSendMessage = vi.fn()
const mockGetTeamMembers = vi.fn()

vi.mock("../team-service.js", () => ({
  getMemberBySession: mockGetMemberBySession,
  getActiveTeamForLead: mockGetActiveTeamForLead,
  resolveRecipients: mockResolveRecipients,
  sendMessage: mockSendMessage,
  getTeamMembers: mockGetTeamMembers,
}))

import { teamSendMessageTool } from "./team-send-message.js"

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

describe("teamSendMessageTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team membership found", async () => {
    mockGetMemberBySession.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamSendMessageTool(client)

    await expect(
      toolDef.execute({ recipient: "lead", body: "Hello" }, context),
    ).rejects.toThrow("No active team membership found")
  })

  it('returns "No valid recipients found." when no recipients resolve', async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([])
    mockResolveRecipients.mockReturnValue([])

    const toolDef = teamSendMessageTool(client)
    const result = await toolDef.execute(
      { recipient: "nobody", body: "Hello" },
      context,
    )

    expect(result).toBe("No valid recipients found.")
  })

  it("successfully sends message and prompts recipients", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m2", sessionID: "lead-1", name: "Lead", status: "active" },
    ])
    mockResolveRecipients.mockReturnValue(["lead-1"])
    mockSendMessage.mockResolvedValue({ messageID: "msg-1" })

    const toolDef = teamSendMessageTool(client)
    const result = await toolDef.execute(
      { recipient: "lead", body: "Hello leader" },
      context,
    )

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ messageID: "msg-1", recipients: ["lead-1"] })
    expect(client.session.prompt).toHaveBeenCalledWith({
      body: {
        noReply: true,
        parts: [{ type: "text", text: expect.stringContaining("team_get_messages") }],
      },
      path: { id: "lead-1" },
    })
  })

  it("resolves 'lead' to leadSessionID for team member", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-abc", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([])
    mockResolveRecipients.mockReturnValue(["lead-session-abc"])
    mockSendMessage.mockResolvedValue({ messageID: "msg-2" })

    const toolDef = teamSendMessageTool(client)
    const result = await toolDef.execute(
      { recipient: "lead", body: "Message to lead" },
      context,
    )

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ messageID: "msg-2", recipients: ["lead-session-abc"] })
  })

  it("works for lead sending messages (via getActiveTeamForLead)", async () => {
    mockGetMemberBySession.mockResolvedValue(null)
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m2", sessionID: "agent-1", name: "Agent1", status: "active" },
    ])
    mockResolveRecipients.mockReturnValue(["agent-1"])
    mockSendMessage.mockResolvedValue({ messageID: "msg-3" })

    const toolDef = teamSendMessageTool(client)
    const result = await toolDef.execute(
      { recipient: "Agent1", body: "How's it going?" },
      { sessionID: "lead-session-1" },
    )

    const parsed = JSON.parse(result)
    expect(parsed).toEqual({ messageID: "msg-3", recipients: ["agent-1"] })
    expect(client.session.prompt).toHaveBeenCalledWith(
      expect.objectContaining({ path: { id: "agent-1" } }),
    )
  })

  it("handles prompt failures gracefully", async () => {
    mockGetMemberBySession.mockResolvedValue({
      member: { id: "m1", name: "agent", sessionID: "member-session-1", status: "active" },
      team: { id: "team-1", name: "test", goal: "x", leadSessionID: "lead-1", status: "active" },
    })
    mockGetTeamMembers.mockResolvedValue([])
    mockResolveRecipients.mockReturnValue(["lead-1"])
    mockSendMessage.mockResolvedValue({ messageID: "msg-4" })
    client.session.prompt = vi.fn().mockRejectedValue(new Error("Session not found"))

    const toolDef = teamSendMessageTool(client)
    const result = await toolDef.execute(
      { recipient: "lead", body: "Hello" },
      context,
    )

    const parsed = JSON.parse(result)
    expect(parsed.messageID).toBe("msg-4")
  })
})
