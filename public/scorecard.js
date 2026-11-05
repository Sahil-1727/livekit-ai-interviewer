const scorecardContent = document.querySelector(".scorecard-content");

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
  document.querySelector("#scorecard-overall").textContent = scorecard.overall.toFixed(1);

  const ratings = document.querySelector("#scorecard-ratings");
  for (const [key, label] of categories) {
    const term = document.createElement("dt");
    term.textContent = label;
    const value = document.createElement("dd");
    value.textContent = `${scorecard.ratings[key]} / 5`;
    ratings.append(term, value);
  }

  const strengths = document.querySelector("#scorecard-strengths");
  for (const strength of scorecard.strengths) {
    const item = document.createElement("li");
    item.textContent = strength;
    strengths.append(item);
  }
  document.querySelector("#scorecard-improvement").textContent = scorecard.improvement;
}

try {
  const rawScorecard = sessionStorage.getItem("interviewScorecard");
  const scorecard = rawScorecard ? JSON.parse(rawScorecard) : null;
  const ratingKeys = ["technical_accuracy", "problem_solving", "communication", "role_relevance"];
  const validRatings = ratingKeys.every((key) => Number.isInteger(scorecard?.ratings?.[key])
    && scorecard.ratings[key] >= 1 && scorecard.ratings[key] <= 5);
  if (!validRatings || typeof scorecard.overall !== "number"
    || !Array.isArray(scorecard.strengths) || scorecard.strengths.length !== 2
    || scorecard.strengths.some((item) => typeof item !== "string")
    || typeof scorecard.improvement !== "string" || typeof scorecard.is_partial !== "boolean") {
    showMissingScorecard();
  } else {
    renderScorecard(scorecard);
  }
} catch {
  showMissingScorecard();
}
