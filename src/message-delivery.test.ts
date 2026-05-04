import { createAntiPollingGuard, deliverTeamMessages } from "./message-delivery.js"
import type { TeamMessage } from "./types.js"

// Mock the dynamic imports
vi.mock("./team-service.js", () => ({
  getMessagesForRecipient: vi.fn(),
}))

vi.mock("./db.js", () => ({
  markAllMessagesDelivered: vi.fn(),
}))

import { getMessagesForRecipient } from "./team-service.js"
import { markAllMessagesDelivered } from "./db.js"

const mockGetMessages = vi.mocked(getMessagesForRecipient)
const mockMarkDelivered = vi.mocked(markAllMessagesDelivered)

function makeMsg(overrides: Partial<TeamMessage> = {}): TeamMessage {
  return {
    id: "msg-1",
    teamID: "team-1",
    sender: "sender-1",
    recipients: ["recipient-1"],
    body: "Hello teammate!",
    deliveryStatus: "pending",
    recipientStatuses: [
      {
        id: "rs-1",
        messageID: "msg-1",
        teamID: "team-1",
        recipient: "recipient-1",
        deliveryStatus: "pending",
        timeCreated: Date.now(),
        timeUpdated: Date.now(),
      },
    ],
    timeCreated: Date.now(),
    timeUpdated: Date.now(),
    ...overrides,
  }
}

function mockClient(shouldThrow = false) {
  const promptMock = vi.fn()
  if (shouldThrow) {
    promptMock.mockRejectedValue(new Error("Session not found"))
  } else {
    promptMock.mockResolvedValue(undefined)
  }
  return { session: { prompt: promptMock } }
}

describe("createAntiPollingGuard", () => {
  it("first check returns null (allowed)", () => {
    const guard = createAntiPollingGuard()
    expect(guard.check()).toBeNull()
  })

  it("second check returns blocking message", () => {
    const guard = createAntiPollingGuard()
    guard.check()
    const result = guard.check()
    expect(result).not.toBeNull()
    expect(result).toContain("Polling Blocked")
    expect(result).toContain("2 times")
  })

  it("third check returns blocking message with count 3", () => {
    const guard = createAntiPollingGuard()
    guard.check()
    guard.check()
    const result = guard.check()
    expect(result).not.toBeNull()
    expect(result).toContain("3 times")
  })

  it("reset clears the counter to 0", () => {
    const guard = createAntiPollingGuard()
    guard.check()
    guard.check()
    guard.reset()
    expect(guard.check()).toBeNull()
  })

  it("reset followed by multiple calls uses fresh counter", () => {
    const guard = createAntiPollingGuard()
    guard.check()
    guard.check()
    guard.check()
    guard.reset()
    guard.check()
    const result = guard.check()
    expect(result).toContain("2 times")
  })

  it("multiple guards are independent", () => {
    const guardA = createAntiPollingGuard()
    const guardB = createAntiPollingGuard()

    guardA.check()
    guardA.check()

    expect(guardB.check()).toBeNull()
    expect(guardA.check()).not.toBeNull()
  })
})

describe("deliverTeamMessages", () => {
  const sessionID = "member-456"
  const teamID = "team-789"

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("returns empty array when no messages", async () => {
    mockGetMessages.mockResolvedValueOnce([])
    const client = mockClient()

    const result = await deliverTeamMessages(sessionID, teamID, client)

    expect(result).toEqual([])
    expect(mockGetMessages).toHaveBeenCalledWith(teamID, sessionID)
    expect(client.session.prompt).not.toHaveBeenCalled()
    expect(mockMarkDelivered).not.toHaveBeenCalled()
  })

  it("calls client.session.prompt with noReply: true and formatted message content", async () => {
    const msg = makeMsg()
    mockGetMessages.mockResolvedValueOnce([msg])
    const client = mockClient()

    await deliverTeamMessages(sessionID, teamID, client)

    expect(client.session.prompt).toHaveBeenCalledTimes(1)
    const callArgs = client.session.prompt.mock.calls[0][0]
    expect(callArgs.body.noReply).toBe(true)
    expect(callArgs.body.parts[0].type).toBe("text")
    expect(callArgs.body.parts[0].text).toContain("<team-messages>")
    expect(callArgs.body.parts[0].text).toContain("</team-messages>")
    expect(callArgs.body.parts[0].text).toContain(msg.body)
    expect(callArgs.path.id).toBe(sessionID)
  })

  it("marks all messages delivered after injecting", async () => {
    const msg = makeMsg()
    mockGetMessages.mockResolvedValueOnce([msg])
    mockMarkDelivered.mockResolvedValueOnce(undefined)
    const client = mockClient()

    await deliverTeamMessages(sessionID, teamID, client)

    expect(mockMarkDelivered).toHaveBeenCalledWith(teamID, sessionID)
    // prompt is called before markAllMessagesDelivered
    expect(client.session.prompt).toHaveBeenCalled()
  })

  it("handles multiple messages", async () => {
    const msg1 = makeMsg({ id: "msg-1", body: "First message" })
    const msg2 = makeMsg({ id: "msg-2", sender: "sender-2", body: "Second message" })
    mockGetMessages.mockResolvedValueOnce([msg1, msg2])
    const client = mockClient()

    await deliverTeamMessages(sessionID, teamID, client)

    const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
    expect(text).toContain("First message")
    expect(text).toContain("Second message")
  })

  it("gracefully handles error from client.session.prompt", async () => {
    const msg = makeMsg()
    mockGetMessages.mockResolvedValueOnce([msg])
    mockMarkDelivered.mockResolvedValueOnce(undefined)
    const client = mockClient(true)

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await deliverTeamMessages(sessionID, teamID, client)

    expect(consoleSpy).toHaveBeenCalledWith("Failed to inject team messages:", expect.any(Error))
    // Still marks messages delivered even if prompt fails
    expect(mockMarkDelivered).toHaveBeenCalledWith(teamID, sessionID)
    expect(result).toEqual([msg])

    consoleSpy.mockRestore()
  })

  it("formats sender label as 'You' when sender is the recipient session", async () => {
    const msg = makeMsg({ sender: sessionID, body: "self note" })
    mockGetMessages.mockResolvedValueOnce([msg])
    const client = mockClient()

    await deliverTeamMessages(sessionID, teamID, client)

    const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
    expect(text).toContain("You:")
  })

  it("formats sender label with sender ID for other senders", async () => {
    const msg = makeMsg({ sender: "other-teammate", body: "hello" })
    mockGetMessages.mockResolvedValueOnce([msg])
    const client = mockClient()

    await deliverTeamMessages(sessionID, teamID, client)

    const text = client.session.prompt.mock.calls[0][0].body.parts[0].text
    expect(text).toContain("From teammate (other-teammate):")
  })
})
