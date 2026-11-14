const scorecardContent = document.querySelector(".scorecard-content");
document.querySelector("#save-scorecard")?.addEventListener("click", () => window.print());

function scorecardToText(card, reflection = "") {
  const categories = {
    technical_accuracy: "Technical accuracy",
    problem_solving: "Problem solving",
    communication: "Communication",
    role_relevance: "Role relevance",
  };
  const lines = ["FIELDNOTE — INTERVIEW FEEDBACK", card.is_partial ? "Partial interview" : "Completed interview", "",
    `Overall: ${card.overall === null ? "Not assessed" : `${card.overall} / 5`}`, ""];
  for (const [key, label] of Object.entries(categories)) {
    lines.push(`${label}: ${card.ratings[key] === null ? "Not assessed" : `${card.ratings[key]} / 5`}`);
    if (card.rating_evidence?.[key]) lines.push(`Evidence: ${card.rating_evidence[key]}`);
    lines.push("");
  }
  lines.push("EVIDENCE FROM YOUR ANSWERS", ...(card.strengths.length ? card.strengths : ["Not enough evidence to identify strengths."]), "",
    "A PLACE TO GROW", card.improvement || "Answer more interview questions to receive a specific improvement suggestion.");
  if (card.improvement_evidence) lines.push(`Evidence: ${card.improvement_evidence}`);
  if (reflection.trim()) lines.push("", "MY PRACTICE NOTES", reflection.trim());
  const conversation = validatedTranscript(card.transcript);
  if (conversation.length) {
    lines.push("", "CONVERSATION TRANSCRIPT", "Browser transcription may contain errors or omit speech.");
    for (const turn of conversation) lines.push(`${turn.speaker}: ${turn.text}`);
  }
  lines.push("", "Ratings reflect interview answers. AI-generated feedback can be imperfect.");
  return lines.join("\n");
}

function validatedTranscript(value) {
  return Array.isArray(value) ? value.filter((turn) => turn && ["You", "Interviewer"].includes(turn.speaker)
    && typeof turn.text === "string" && turn.text.trim()) : [];
}

function enableScorecardDownload(card) {
  document.querySelector("#download-scorecard")?.addEventListener("click", () => {
    let url;
    try {
      const reflection = document.querySelector("#practice-reflection")?.value || "";
      url = URL.createObjectURL(new Blob([scorecardToText(card, reflection)], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "fieldnote-interview-feedback.txt";
      document.body.append(link);
      link.click();
      link.remove();
      document.querySelector("#export-status").textContent = "Download requested. Check your browser’s downloads.";
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      if (url) URL.revokeObjectURL(url);
      document.querySelector("#export-status").textContent = "Download unavailable. Use Save or print scorecard instead.";
    }
  });
}

function showMissingScorecard() {
  scorecardContent.replaceChildren();
  const eyebrow = document.createElement("div");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "INTERVIEW RESULTS";
  const heading = document.createElement("h1");
  heading.textContent = "Scorecard unavailable";
  const message = document.createElement("p");
  message.className = "scorecard-intro";
  message.textContent = "This scorecard is no longer available in this browser tab.";
  const link = document.createElement("a");
  link.className = "start-button scorecard-home";
  link.href = "/";
  link.textContent = "Return to interview setup";
  scorecardContent.append(eyebrow, heading, message, link);
}

function renderScorecard(scorecard) {
  const conversation = validatedTranscript(scorecard.transcript);
  const review = document.querySelector("#conversation-review-content");
  document.querySelector("#review-count").textContent = conversation.length ? `${conversation.length} turns` : "";
  if (!conversation.length) {
    const empty = document.createElement("p");
    empty.textContent = "No conversation transcript was available for this session.";
    review.append(empty);
  }
  for (const turn of conversation) {
    const line = document.createElement("p");
    const speaker = document.createElement("strong");
    speaker.textContent = `${turn.speaker}: `;
    line.append(speaker, document.createTextNode(turn.text));
    review.append(line);
  }
  const categories = [
    ["technical_accuracy", "Technical accuracy"],
    ["problem_solving", "Problem solving"],
    ["communication", "Communication"],
    ["role_relevance", "Role relevance"],
  ];

  const title = document.querySelector("#scorecard-title");
  const titleLead = document.createTextNode(scorecard.is_partial ? "Your partial" : "Your interview");
  const titleBreak = document.createElement("br");
  const titleEnd = document.createElement("em");
  titleEnd.textContent = "scorecard.";
  title.replaceChildren(titleLead, titleBreak, titleEnd);
  document.querySelector("#scorecard-summary").textContent = scorecard.is_partial
    ? "You ended the interview early. This scorecard reflects the answers available so far."
    : "Your interview feedback, based on the answers and role details provided.";
  const overall = document.querySelector("#scorecard-overall");
  overall.textContent = scorecard.overall === null ? "Not assessed" : scorecard.overall.toFixed(1);
  overall.classList.toggle("not-assessed", scorecard.overall === null);
  document.querySelector("#scorecard-overall-note").textContent = scorecard.overall === null
    ? "Not enough evidence to rate every area."
    : "out of 5";

  const ratings = document.querySelector("#scorecard-ratings");
  for (const [key, label] of categories) {
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.textContent = scorecard.ratings[key] === null ? "Not assessed" : `${scorecard.ratings[key]} / 5`;
    const evidence = scorecard.rating_evidence?.[key];
    if (typeof evidence === "string" && evidence) {
      const quote = document.createElement("small");
      quote.className = "scorecard-evidence";
      quote.textContent = `“${evidence}”`;
      value.append(quote);
    }
    ratings.append(term, value);
  }

  const strengths = document.querySelector("#scorecard-strengths");
  if (!scorecard.strengths.length) {
    const item = document.createElement("li");
    item.textContent = "Not enough interview evidence to identify strengths.";
    strengths.append(item);
  }
  for (const [index, strength] of scorecard.strengths.entries()) {
    const item = document.createElement("li");
    item.textContent = strength;
    const evidence = scorecard.strength_evidence?.[index];
    if (typeof evidence === "string" && evidence) {
      const quote = document.createElement("small");
      quote.className = "scorecard-evidence";
      quote.textContent = `“${evidence}”`;
      item.append(quote);
    }
    strengths.append(item);
  }
  const improvement = document.querySelector("#scorecard-improvement");
  improvement.textContent = scorecard.improvement || "Answer more interview questions to receive a specific improvement suggestion.";
  if (typeof scorecard.improvement_evidence === "string" && scorecard.improvement_evidence) {
    const quote = document.createElement("small");
    quote.className = "scorecard-evidence";
    quote.textContent = `“${scorecard.improvement_evidence}”`;
    improvement.append(quote);
  }
}

try {
  const rawScorecard = sessionStorage.getItem("interviewScorecard");
  const scorecard = rawScorecard ? JSON.parse(rawScorecard) : null;
  const ratingKeys = ["technical_accuracy", "problem_solving", "communication", "role_relevance"];
  const validRatings = ratingKeys.every((key) => scorecard?.ratings?.[key] === null
    || (Number.isInteger(scorecard?.ratings?.[key]) && scorecard.ratings[key] >= 1 && scorecard.ratings[key] <= 5));
  if (!validRatings || (scorecard.overall !== null && (typeof scorecard.overall !== "number" || !Number.isFinite(scorecard.overall)))
    || !Array.isArray(scorecard.strengths) || scorecard.strengths.length > 2
    || scorecard.strengths.some((item) => typeof item !== "string")
    || (scorecard.improvement !== null && typeof scorecard.improvement !== "string")
    || typeof scorecard.is_partial !== "boolean") {
    showMissingScorecard();
  } else {
    renderScorecard(scorecard);
    enableScorecardDownload(scorecard);
  }
} catch {
  showMissingScorecard();
}
