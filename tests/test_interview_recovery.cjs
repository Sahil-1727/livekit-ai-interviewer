const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");

function functionSource(start, end) {
  return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
}

test("draft storage saves only the opted-in JD and forgetting preserves the form text", () => {
  const saved = new Map();
  const context = {
    clearTimeout() {}, draftTimer: null,
    rememberJD: { checked: true },
    jobDescriptionInput: { value: "Backend role using APIs and SQL." },
    draftStatus: {}, JD_DRAFT_KEY: "fieldnote.jd-draft.v1",
    localStorage: { setItem: (key, value) => saved.set(key, value), removeItem: (key) => saved.delete(key) },
  };
  vm.createContext(context);
  vm.runInContext(functionSource("function saveJobDescriptionDraft", "rememberJD.addEventListener"), context);
  context.saveJobDescriptionDraft();
  assert.equal(saved.size, 1);
  assert.equal(saved.get(context.JD_DRAFT_KEY), context.jobDescriptionInput.value);
  context.rememberJD.checked = false;
  context.saveJobDescriptionDraft();
  assert.equal(saved.size, 0);
  assert.equal(context.jobDescriptionInput.value, "Backend role using APIs and SQL.");
});

test("microphone preflight releases the device after checking access", async () => {
  let stopped = 0;
  const track = { stop: () => { stopped++; } };
  const context = { navigator: { mediaDevices: { getUserMedia: async (constraints) => {
    assert.equal(constraints.audio, true);
    assert.equal(constraints.video, false);
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } } };
  vm.createContext(context);
  vm.runInContext(functionSource("async function verifyMicrophoneAccess", "microphoneCheck.addEventListener"), context);
  await context.verifyMicrophoneAccess();
  assert.equal(stopped, 1);
});

test("blocked microphone permission is returned to the preparation flow", async () => {
  const context = { navigator: { mediaDevices: { getUserMedia: async () => {
    throw new DOMException("Permission denied", "NotAllowedError");
  } } } };
  vm.createContext(context);
  vm.runInContext(functionSource("async function verifyMicrophoneAccess", "microphoneCheck.addEventListener"), context);
  await assert.rejects(context.verifyMicrophoneAccess(), { name: "NotAllowedError" });
});

test("session request aborts and releases its timer when the server stalls", async () => {
  let abort;
  let cleared = false;
  const context = {
    AbortController,
    setTimeout(callback) { abort = callback; return 42; },
    clearTimeout(id) { assert.equal(id, 42); cleared = true; },
    fetch: (url, { signal }) => new Promise((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    }),
  };
  vm.createContext(context);
  vm.runInContext(functionSource("async function fetchWithTimeout", "async function verifyMicrophoneAccess"), context);
  const request = context.fetchWithTimeout("/api/connection-details");
  abort();
  await assert.rejects(request, { name: "AbortError" });
  assert.equal(cleared, true);
});

test("successful session requests keep their response and release the timer", async () => {
  const response = { ok: true };
  let cleared = false;
  const context = {
    AbortController,
    setTimeout: () => 42,
    clearTimeout: () => { cleared = true; },
    fetch: async () => response,
  };
  vm.createContext(context);
  vm.runInContext(functionSource("async function fetchWithTimeout", "async function verifyMicrophoneAccess"), context);
  assert.equal(await context.fetchWithTimeout("/api/connection-details"), response);
  assert.equal(cleared, true);
});

test("blocked storage retains the ready scorecard and retry opens it without regenerating", async () => {
  let blocked = true;
  let disconnected = 0;
  let destination;
  const card = { overall: null };
  const context = {
    validScorecard: () => true,
    pendingScorecard: null,
    startButton: { disabled: true },
    connectionError: {},
    setStatus() {},
    showToast() {},
    room: { disconnect: async () => { disconnected++; } },
    sessionStorage: { setItem(key, value) {
      if (blocked) throw new Error("Storage blocked");
      assert.equal(key, "interviewScorecard");
      assert.equal(JSON.parse(value).overall, null);
    } },
    window: { location: { assign: (url) => { destination = url; } } },
  };
  vm.createContext(context);
  vm.runInContext(functionSource("async function openScorecardPage", "function formatElapsed"), context);
  await context.openScorecardPage(card);
  assert.equal(context.pendingScorecard, card);
  assert.equal(context.startButton.disabled, false);
  assert.equal(disconnected, 0);
  assert.equal(destination, undefined);
  blocked = false;
  await context.openScorecardPage(context.pendingScorecard);
  assert.equal(disconnected, 1);
  assert.equal(destination, "/scorecard.html");
  assert.equal(context.pendingScorecard, null);
});
