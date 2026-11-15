const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const source = fs.readFileSync(path.join(root, "public/app.js"), "utf8").replace(/^import[^\n]+\n/, "");

function setup() {
  const nodes = new Map([...html.matchAll(/id="([^"]+)"/g)].map((match) => ["#" + match[1], {
    value: "", files: [], disabled: false, hidden: false, checked: false,
    textContent: "", innerHTML: "", listeners: {},
    addEventListener(name, handler) { this.listeners[name] = handler; },
    setAttribute() {},
    classList: { add() {}, remove() {}, toggle() {} },
  }]));
  let requestCount = 0;
  const context = {
    document: {
      querySelector: (selector) => nodes.get(selector) || null,
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {} } },
    },
    navigator: { mediaDevices: { getUserMedia: async () => { throw new DOMException("Denied", "NotAllowedError"); } } },
    fetch: async (url) => {
      if (url !== "/api/access-config") requestCount++;
      return { ok: true, json: async () => ({}) };
    },
    localStorage: { getItem: () => null },
    sessionStorage: { removeItem() {} },
    setInterval() {}, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    Intl, Date, console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, nodes, requests: () => requestCount };
}

test("whole setup script starts with the current HTML and enables start only for valid details", () => {
  const { context, nodes } = setup();
  assert.equal(nodes.get("#start-button").disabled, true);
  nodes.get("#job-description-text").value = "A backend role building Python APIs and SQL databases.";
  nodes.get("#access-code").value = "test-code";
  nodes.get("#resume-file").files = [{ name: "resume.pdf", type: "application/pdf", size: 200 }];
  context.updateUploadState();
  assert.equal(nodes.get("#start-button").disabled, false);
  assert.equal(nodes.get("#setup-progress").value, 3);
  nodes.get("#resume-file").files[0].size = 0;
  context.updateUploadState();
  assert.equal(nodes.get("#start-button").disabled, true);
});

test("denied microphone never requests a session and restores the prepared form", async () => {
  const { context, nodes, requests } = setup();
  const jd = "A backend role building Python APIs and SQL databases.";
  nodes.get("#job-description-text").value = jd;
  nodes.get("#access-code").value = "test-code";
  nodes.get("#resume-file").files = [{ name: "resume.pdf", type: "application/pdf", size: 200 }];
  await context.connect();
  assert.equal(requests(), 0);
  assert.equal(nodes.get("#job-description-text").value, jd);
  assert.equal(nodes.get("#resume-file").files.length, 1);
  assert.equal(nodes.get("#job-description-text").disabled, false);
  assert.equal(nodes.get("#start-button").disabled, false);
  assert.equal(nodes.get("#connection-error").hidden, false);
  assert.match(nodes.get("#connection-error").textContent, /Microphone access was blocked/);
});

test("offline candidates keep their preparation without requesting an interview", async () => {
  const { context, nodes, requests } = setup();
  context.navigator.onLine = false;
  nodes.get("#job-description-text").value = "A backend role building Python APIs and SQL databases.";
  nodes.get("#access-code").value = "test-code";
  nodes.get("#resume-file").files = [{ name: "resume.pdf", type: "application/pdf", size: 200 }];
  context.updateUploadState();
  await context.connect();
  assert.equal(requests(), 0);
  assert.equal(nodes.get("#start-button").disabled, false);
  assert.match(nodes.get("#connection-error").textContent, /offline/);
});
