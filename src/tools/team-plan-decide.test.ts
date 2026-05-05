const mockGetActiveTeamForLead = vi.fn()
const mockGetTeamMembers = vi.fn()
const mockUpdateMemberStatus = vi.fn()
const mockSetMemberPlanMode = vi.fn()
const mockSendMessage = vi.fn()

vi.mock("../team-service.js", () => ({
  getActiveTeamForLead: mockGetActiveTeamForLead,
  getTeamMembers: mockGetTeamMembers,
  updateMemberStatus: mockUpdateMemberStatus,
  setMemberPlanMode: mockSetMemberPlanMode,
  sendMessage: mockSendMessage,
}))

import { teamPlanDecideTool } from "./team-plan-decide.js"

function createMockClient() {
  return {
    session: {
      prompt: vi.fn().mockResolvedValue({}),
      create: vi.fn().mockResolvedValue({}),
      get: vi.fn().mockResolvedValue({ data: { permission: {} } }),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
      messages: vi.fn().mockResolvedValue({}),
    },
    tui: {
      showToast: vi.fn().mockResolvedValue({}),
    },
  }
}

const context = { sessionID: "lead-session-1" }

describe("teamPlanDecideTool", () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
    vi.clearAllMocks()
  })

  it("throws if no active team found (not lead)", async () => {
    mockGetActiveTeamForLead.mockResolvedValue(null)

    const toolDef = teamPlanDecideTool(client)

    await expect(
      toolDef.execute({ member_name: "agent-1", decision: "approve" }, context),
    ).rejects.toThrow("No active team found")
  })

  it('throws if teammate not found by name', async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "s1", name: "other-agent", status: "blocked" },
    ])

    const toolDef = teamPlanDecideTool(client)

    await expect(
      toolDef.execute({ member_name: "nonexistent", decision: "approve" }, context),
    ).rejects.toThrow('No teammate found with name "nonexistent"')
  })

  it("approves plan — updates member status to active and sends approval message", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "agent-1", name: "agent-1", status: "blocked", planMode: true },
    ])
    mockUpdateMemberStatus.mockResolvedValue(undefined)
    mockSendMessage.mockResolvedValue({ messageID: "msg-1" })

    const toolDef = teamPlanDecideTool(client)
    const result = await toolDef.execute(
      { member_name: "agent-1", decision: "approve" },
      context,
    )

    expect(result).toBe("Plan from agent-1 approved. Teammate notified.")
    expect(mockUpdateMemberStatus).toHaveBeenCalledWith("m1", "active")
    expect(mockSetMemberPlanMode).toHaveBeenCalledWith("m1", false)

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        teamID: "team-1",
        sender: "lead-session-1",
        recipients: ["agent-1"],
        body: expect.stringContaining("Plan Approved"),
      }),
    )

    expect(client.session.prompt).toHaveBeenCalledWith({
      body: {
        noReply: true,
        parts: [{ type: "text", text: expect.stringContaining("approved") }],
      },
      path: { id: "agent-1" },
    })
  })

  it("rejects plan — sends rejection message", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "agent-1", name: "agent-1", status: "blocked", planMode: true },
    ])
    mockSendMessage.mockResolvedValue({ messageID: "msg-2" })

    const toolDef = teamPlanDecideTool(client)
    const result = await toolDef.execute(
      { member_name: "agent-1", decision: "reject", feedback: "Needs more detail" },
      context,
    )

    expect(result).toBe("Plan from agent-1 rejected. Feedback sent.")
    expect(mockUpdateMemberStatus).not.toHaveBeenCalled()
    expect(mockSetMemberPlanMode).not.toHaveBeenCalled()

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.stringContaining("Plan Rejected"),
      }),
    )

    const sendCall = mockSendMessage.mock.calls[0][0]
    expect(sendCall.body).toContain("Needs more detail")
  })

  it("includes feedback in approval message when provided", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "agent-1", name: "agent-1", status: "blocked", planMode: true },
    ])
    mockUpdateMemberStatus.mockResolvedValue(undefined)
    mockSendMessage.mockResolvedValue({ messageID: "msg-3" })

    const toolDef = teamPlanDecideTool(client)
    await toolDef.execute(
      { member_name: "agent-1", decision: "approve", feedback: "Looks good, proceed" },
      context,
    )

    const sendCall = mockSendMessage.mock.calls[0][0]
    expect(sendCall.body).toContain("Looks good, proceed")
  })

  it("handles prompt failure gracefully on approve", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "agent-1", name: "agent-1", status: "blocked", planMode: true },
    ])
    mockUpdateMemberStatus.mockResolvedValue(undefined)
    mockSendMessage.mockResolvedValue({ messageID: "msg-4" })
    client.session.prompt = vi.fn().mockRejectedValue(new Error("Agent session gone"))

    const toolDef = teamPlanDecideTool(client)
    const result = await toolDef.execute(
      { member_name: "agent-1", decision: "approve" },
      context,
    )

    expect(result).toBe("Plan from agent-1 approved. Teammate notified.")
  })

  it("handles prompt failure gracefully on reject", async () => {
    mockGetActiveTeamForLead.mockResolvedValue({
      id: "team-1", name: "test", goal: "x", leadSessionID: "lead-session-1", status: "active",
    })
    mockGetTeamMembers.mockResolvedValue([
      { id: "m1", sessionID: "agent-1", name: "agent-1", status: "blocked", planMode: true },
    ])
    mockSendMessage.mockResolvedValue({ messageID: "msg-5" })
    client.session.prompt = vi.fn().mockRejectedValue(new Error("Agent session gone"))

    const toolDef = teamPlanDecideTool(client)
    const result = await toolDef.execute(
      { member_name: "agent-1", decision: "reject", feedback: "Revise" },
      context,
    )

    expect(result).toBe("Plan from agent-1 rejected. Feedback sent.")
  })
})
