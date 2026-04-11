import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PairingIO } from './telegram_pairing.js';

// ── Telegram mock ────────────────────────────────────────────────────
const mockGetMe = vi.fn();
const mockGetUpdates = vi.fn();
const mockSendMessage = vi.fn();
const mockDeleteWebhook = vi.fn().mockResolvedValue(true);

function MockTelegram() {
  return {
    getMe: mockGetMe,
    getUpdates: mockGetUpdates,
    sendMessage: mockSendMessage,
    deleteWebhook: mockDeleteWebhook,
  };
}

vi.mock('telegraf', () => ({ Telegram: MockTelegram }));

// Import after mocks are in place
import { runTelegramPairing } from './telegram_pairing.js';

// ── Helpers ──────────────────────────────────────────────────────────

/** Extract the 6-digit code from the sendMessage mock call text. */
function extractCodeFromSendMessage(): string {
  const text = mockSendMessage.mock.calls[0][1] as string;
  const match = text.match(/`(\d{6})`/);
  if (!match) throw new Error('Could not extract code from sendMessage');
  return match[1];
}

function createFakeIO(overrides: Partial<PairingIO> = {}): PairingIO {
  return {
    print: vi.fn(),
    choose: vi.fn().mockResolvedValue(0),
    confirm: vi.fn().mockResolvedValue(true),
    // Default prompt: extract the code that was sent and echo it back
    prompt: vi.fn().mockImplementation(() => {
      return Promise.resolve(extractCodeFromSendMessage());
    }),
    ...overrides,
  };
}

function makeUpdate(chatId: number, type: string, date: number, name = 'Test User') {
  return {
    message: {
      date,
      chat: {
        id: chatId,
        type,
        first_name: name,
        last_name: '',
      },
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('runTelegramPairing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMe.mockResolvedValue({ username: 'test_bot', first_name: 'TestBot' });
    mockGetUpdates.mockResolvedValue([
      makeUpdate(111, 'private', 1000, 'Alice'),
      makeUpdate(222, 'private', 2000, 'Bob'),
    ]);
    mockSendMessage.mockResolvedValue({});
  });

  it('validates the bot token via getMe', async () => {
    const io = createFakeIO();
    await runTelegramPairing('token', io);

    expect(mockGetMe).toHaveBeenCalled();
    expect(io.print).toHaveBeenCalledWith(expect.stringContaining('@test_bot'));
  });

  it('throws a clear error when token is invalid', async () => {
    mockGetMe.mockRejectedValue(new Error('401: Unauthorized'));
    const io = createFakeIO();

    await expect(runTelegramPairing('bad-token', io))
      .rejects.toThrow(/Invalid Telegram bot token/);
  });

  it('sorts chats by most recent first', async () => {
    const io = createFakeIO();
    await runTelegramPairing('token', io);

    // io.choose should have been called with Bob (date 2000) first
    const options = (io.choose as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(options[0]).toContain('Bob');
    expect(options[1]).toContain('Alice');
  });

  it('deduplicates chats keeping the most recent message', async () => {
    mockGetUpdates.mockResolvedValue([
      makeUpdate(111, 'private', 1000, 'Alice'),
      makeUpdate(111, 'private', 3000, 'Alice'),
      makeUpdate(222, 'private', 2000, 'Bob'),
    ]);

    const io = createFakeIO();
    await runTelegramPairing('token', io);

    const options = (io.choose as ReturnType<typeof vi.fn>).mock.calls[0][1] as string[];
    expect(options).toHaveLength(2);
    // Alice (date 3000) should now be first
    expect(options[0]).toContain('Alice');
  });

  it('throws when no chats are found', async () => {
    mockGetUpdates.mockResolvedValue([]);
    const io = createFakeIO();

    await expect(runTelegramPairing('token', io))
      .rejects.toThrow(/No chats found/);
  });

  it('exits cleanly when user declines confirmation', async () => {
    const io = createFakeIO({ confirm: vi.fn().mockResolvedValue(false) });

    await expect(runTelegramPairing('token', io))
      .rejects.toThrow(/Pairing cancelled/);
  });

  it('sends a 6-digit code to the chosen chat', async () => {
    const io = createFakeIO();
    await runTelegramPairing('token', io);

    expect(mockSendMessage).toHaveBeenCalledWith(
      '222', // Bob is index 0 (most recent), chosen by default
      expect.stringMatching(/`\d{6}`/),
      expect.objectContaining({ parse_mode: 'Markdown' }),
    );
  });

  it('succeeds when correct code is entered on first attempt', async () => {
    const io = createFakeIO();
    const result = await runTelegramPairing('token', io);

    expect(result.chatId).toBe('222');
    expect(result.chatTitle).toBe('Bob');
  });

  it('succeeds when correct code is entered on second attempt', async () => {
    let callCount = 0;
    const prompt = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) return Promise.resolve('000000');
      return Promise.resolve(extractCodeFromSendMessage());
    });
    const io = createFakeIO({ prompt });

    const result = await runTelegramPairing('token', io);

    expect(result.chatId).toBe('222');
    expect(io.print).toHaveBeenCalledWith(expect.stringContaining('2 attempts remaining'));
  });

  it('fails after 3 incorrect code attempts', async () => {
    const prompt = vi.fn().mockResolvedValue('000000');
    const io = createFakeIO({ prompt });

    await expect(runTelegramPairing('token', io))
      .rejects.toThrow(/incorrect code entered 3 times/);
  });

  it('returns the selected chat when user picks a non-default option', async () => {
    const io = createFakeIO({ choose: vi.fn().mockResolvedValue(1) });

    const result = await runTelegramPairing('token', io);

    // Index 1 = Alice (second in the sorted list)
    expect(result.chatId).toBe('111');
    expect(result.chatTitle).toBe('Alice');
  });

  it('throws when sendMessage fails', async () => {
    mockSendMessage.mockRejectedValue(new Error('chat not found'));
    const io = createFakeIO();

    await expect(runTelegramPairing('token', io))
      .rejects.toThrow(/Failed to send pairing code/);
  });

  it('handles group chats with title', async () => {
    mockGetUpdates.mockResolvedValue([{
      message: {
        date: 5000,
        chat: { id: 333, type: 'group', title: 'Dev Team' },
      },
    }]);

    const io = createFakeIO();
    const result = await runTelegramPairing('token', io);

    expect(result.chatTitle).toBe('Dev Team');
  });
});
