const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const scorecardSource = fs.readFileSync(path.join(root, "public/scorecard.js"), "utf8");
const appSource = fs.readFileSync(path.join(root, "public/app.js"), "utf8");

function element() {
  const classes = new Set();
  return {
    textContent: "",
    children: [],
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

function render(scorecard) {
  const nodes = new Map();
  const document = {
    querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, element());
      return nodes.get(selector);
    },
    createElement: element,
    createTextNode: (text) => ({ textContent: text }),
  };
  vm.runInNewContext(scorecardSource, {
    document,
    sessionStorage: { getItem: () => JSON.stringify(scorecard) },
  });
  return nodes;
}

function validator() {
  const start = appSource.indexOf("function validScorecard(");
  const end = appSource.indexOf("\nasync function openScorecardPage", start);
  assert.ok(start >= 0 && end > start, "scorecard validation is available");
  return vm.runInNewContext(`${appSource.slice(start, end)}\nvalidScorecard`);
}

test("an introduction-only scorecard is accepted and shown as not assessed", () => {
  const card = {
    ratings: { technical_accuracy: null, problem_solving: null, communication: null, role_relevance: null },
    overall: null,
    strengths: [],
    improvement: null,
    is_partial: true,
  };

  assert.equal(validator()(card), true);
  const nodes = render(card);
  assert.equal(nodes.get("#scorecard-overall").textContent, "Not assessed");
  assert.match(nodes.get("#scorecard-overall-note").textContent, /not enough evidence/i);
  const values = nodes.get("#scorecard-ratings").children.filter((_, index) => index % 2 === 1);
  assert.equal(values.length, 4);
  assert.ok(values.every((item) => item.textContent === "Not assessed"));
  assert.match(nodes.get("#scorecard-strengths").children[0].textContent, /not enough interview evidence/i);
});

test("an evidenced partial rating shows its candidate quote without an overall score", () => {
  const quote = "I built a small API with Flask";
  const card = {
    ratings: { technical_accuracy: 3, problem_solving: null, communication: null, role_relevance: null },
    rating_evidence: { technical_accuracy: quote },
    overall: null,
    strengths: [quote],
    strength_evidence: [],
    improvement: "Explain the technical steps and check the details of your approach.",
    improvement_evidence: quote,
    is_partial: true,
  };

  assert.equal(validator()(card), true);
  const nodes = render(card);
  assert.equal(nodes.get("#scorecard-overall").textContent, "Not assessed");
  assert.equal(nodes.get("#scorecard-ratings").children[1].textContent, "3 / 5");
  assert.match(nodes.get("#scorecard-ratings").children[1].children[0].textContent, /small API with Flask/);
  assert.equal(nodes.get("#scorecard-strengths").children[0].textContent, quote);
  assert.match(nodes.get("#scorecard-improvement").children[0].textContent, /small API with Flask/);
});

test("older fully scored cards still render during the rollout", () => {
  const card = {
    ratings: { technical_accuracy: 3, problem_solving: 4, communication: 3, role_relevance: 4 },
    overall: 3.5,
    strengths: ["First strength", "Second strength"],
    improvement: "Explain trade-offs",
    is_partial: true,
  };

  assert.equal(validator()(card), true);
  assert.equal(render(card).get("#scorecard-overall").textContent, "3.5");
});
