const originalWebSocket = globalThis.WebSocket;
const sockets: FakeSocket[] = [];
let diagnostics: typeof import("./convex-client").socketDiagnostics;

class FakeSocket {
  readyState = 0;
  sent: unknown[] = [];
  private listeners = new Map<string, ((event: Record<string, unknown>) => void)[]>();

  constructor() {
    sockets.push(this);
  }

  addEventListener(type: string, callback: (event: Record<string, unknown>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), callback]);
  }

  emit(type: string, event: Record<string, unknown> = {}) {
    if (type === "open") this.readyState = 1;
    if (type === "close") this.readyState = 3;
    for (const callback of this.listeners.get(type) ?? []) callback(event);
  }

  send(data: unknown) {
    this.sent.push(data);
  }
}

let Socket: typeof FakeSocket;
jest.mock("convex/react", () => ({
  ConvexReactClient: class {
    constructor(_url: string, options: { webSocketConstructor: typeof FakeSocket }) {
      Socket = options.webSocketConstructor;
    }
  },
}));

beforeEach(() => {
  jest.useFakeTimers({ now: 1_800_000_000_000 });
  sockets.length = 0;
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket;
  jest.isolateModules(() => {
    diagnostics = jest.requireActual<typeof import("./convex-client")>("./convex-client").socketDiagnostics;
  });
});

afterEach(() => {
  globalThis.WebSocket = originalWebSocket;
  jest.useRealTimers();
});

it("distinguishes a handshake that never opens from a closed socket without recording event content", () => {
  expect(diagnostics()).toEqual({
    socket_ready_state: null,
    socket_attempt_ms: null,
    socket_last_open_ms: null,
    socket_last_message_ms: null,
    socket_last_error_ms: null,
    socket_last_close_ms: null,
    socket_last_close_code: null,
  });
  const socket = new Socket();
  jest.advanceTimersByTime(30_000);
  expect(diagnostics()).toMatchObject({ socket_ready_state: 0, socket_attempt_ms: 30_000 });
  socket.emit("error", { message: "secret-token and private endpoint" });
  socket.emit("close", { code: 1006, reason: "private server reason" });
  jest.advanceTimersByTime(500);
  expect(diagnostics()).toEqual({
    socket_ready_state: 3,
    socket_attempt_ms: 30_500,
    socket_last_open_ms: null,
    socket_last_message_ms: null,
    socket_last_error_ms: 500,
    socket_last_close_ms: 500,
    socket_last_close_code: 1006,
  });
});

it("keeps the last transport failure across reconnects and ignores late events from replaced sockets", () => {
  const first = new Socket();
  first.emit("open");
  first.emit("message", { data: "private query result" });
  first.emit("close", { code: 1011, reason: "private reason" });
  jest.advanceTimersByTime(1_000);
  const second = new Socket();
  first.emit("error");
  first.emit("message", { data: "late private result" });
  first.emit("close", { code: 1000 });
  expect(diagnostics()).toMatchObject({
    socket_ready_state: 0,
    socket_attempt_ms: 0,
    socket_last_open_ms: 1_000,
    socket_last_message_ms: 1_000,
    socket_last_error_ms: null,
    socket_last_close_code: 1011,
  });
  second.emit("open");
  second.emit("message", { data: "another private result" });
  expect(diagnostics()).toMatchObject({ socket_ready_state: 1, socket_last_open_ms: 0, socket_last_message_ms: 0 });
});

it("bounds ages and close codes, while preserving the existing Connect stamp and other outgoing messages", () => {
  const socket = new Socket();
  socket.emit("close", { code: Number.NaN });
  jest.advanceTimersByTime(7_200_000);
  expect(diagnostics()).toMatchObject({ socket_attempt_ms: 3_600_000, socket_last_close_code: null });
  jest.setSystemTime(0);
  expect(diagnostics()).toMatchObject({ socket_attempt_ms: 0, socket_last_close_ms: 0 });
  socket.send(JSON.stringify({ type: "Connect", clientTs: 123, sessionId: "session" }));
  const authenticate = JSON.stringify({ type: "Authenticate", value: "secret-token" });
  socket.send(authenticate);
  expect(socket.sent).toEqual([JSON.stringify({ type: "Connect", clientTs: 0, sessionId: "session" }), authenticate]);
});
