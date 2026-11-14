import { Room, RoomEvent, Track } from "https://cdn.jsdelivr.net/npm/livekit-client@2.15.6/+esm";

const startButton = document.querySelector("#start-button");
const muteButton = document.querySelector("#mute-button");
const statusText = document.querySelector("#status-text");
const statusLight = document.querySelector("#status-light");
const visualizer = document.querySelector("#visualizer");
const caption = document.querySelector("#visualizer-caption");
const transcript = document.querySelector("#transcript");
const elapsed = document.querySelector("#elapsed");
const toast = document.querySelector("#toast");
const documentUpload = document.querySelector("#document-upload");
const jobDescriptionInput = document.querySelector("#job-description-text");
const resumeInput = document.querySelector("#resume-file");
const uploadNote = document.querySelector("#upload-note");
const accessCodeInput = document.querySelector("#access-code");
const requestAccessLink = document.querySelector("#request-access-link");
const jdCharacterCount = document.querySelector("#jd-character-count");
const audioRecovery = document.querySelector("#audio-recovery");
let interviewerHasSpoken = false;
let connecting = false;
let pendingScorecard = null;
let conversationLog = [];
const connectionError = document.querySelector("#connection-error");
const microphoneCheck = document.querySelector("#microphone-check");
const microphoneCheckStatus = document.querySelector("#microphone-check-status");
let checkingMicrophone = false;
const MAX_RESUME_BYTES = 3_900_000;

let room;
let connectedAt;
let timer;
let toastTimer;
let muted = false;
let conversationStarted = false;
let endingInterview = false;
let scorecardDelivered = false;

fetch("/api/access-config")
  .then((response) => response.ok ? response.json() : null)
  .then((config) => {
    if (config?.request_email) {
      const email = config.request_email.trim();
      const subject = "AI Interviewer demo access request";
      const body = "Name:\nWork email:\nIntended use:\n";
      const domain = email.split("@").at(-1)?.toLowerCase();
      if (domain === "gmail.com" || domain === "googlemail.com") {
        const params = new URLSearchParams({
          view: "cm",
          fs: "1",
          to: email,
          su: subject,
          body,
        });
        requestAccessLink.href = `https://mail.google.com/mail/?${params}`;
        requestAccessLink.target = "_blank";
        requestAccessLink.rel = "noopener noreferrer";
      } else {
        const params = new URLSearchParams({ subject, body });
        requestAccessLink.href = `mailto:${encodeURIComponent(email)}?${params}`;
      }
      requestAccessLink.hidden = false;
    }
  })
  .catch(() => {});

function selectedInputs() {
  const jobDescription = jobDescriptionInput.value.trim();
  const resume = resumeInput.files[0];
  const accessCode = accessCodeInput.value.trim();
  return jobDescription && resume && accessCode ? { jobDescription, resume, accessCode } : null;
}

function updateUploadState() {
  const jobDescription = jobDescriptionInput.value.trim();
  const resume = resumeInput.files[0];
  jdCharacterCount.textContent = `${jobDescriptionInput.value.length.toLocaleString()} / 12,000`;
  const accessCode = accessCodeInput.value.trim();
  const validResume = Boolean(resume && resume.size > 0 && resume.size <= MAX_RESUME_BYTES
    && (resume.type === "application/pdf" || resume.name.toLowerCase().endsWith(".pdf")));
  const readyCount = Number(Boolean(accessCode)) + Number(jobDescription.length >= 40) + Number(validResume);
  document.querySelector("#setup-progress").value = readyCount;
  document.querySelector("#setup-progress-text").textContent = `${readyCount} of 3 details ready${readyCount === 3 ? " · You’re ready to begin" : ""}`;
  if (connecting || conversationStarted || checkingMicrophone) return;
  if (!jobDescription || !resume || !accessCode) {
    startButton.disabled = true;
    startButton.innerHTML = `<span class="button-icon">↗</span><span>${accessCode && jobDescription && resume ? "Check interview details" : "Complete interview details"}</span>`;
    if (!resume || !jobDescription) uploadNote.textContent = "Paste the job description and attach your resume as a PDF.";
    else uploadNote.textContent = "Enter the demo access code from your invite.";
    uploadNote.classList.remove("error");
    return;
  }

  const validType = resume.type === "application/pdf" || resume.name.toLowerCase().endsWith(".pdf");
  const validSize = resume.size > 0 && resume.size <= MAX_RESUME_BYTES;
  if (jobDescription.length < 40 || !validType || !validSize) {
    startButton.disabled = true;
    startButton.innerHTML = '<span class="button-icon">↗</span><span>Check interview details</span>';
    uploadNote.textContent = jobDescription.length < 40
      ? "Paste at least 40 characters of the job description."
      : validType
        ? "The resume PDF must be smaller than 3.9 MB."
        : "Choose a PDF file for the resume.";
    uploadNote.classList.add("error");
    return;
  }

  startButton.disabled = false;
  startButton.innerHTML = '<span class="button-icon">↗</span><span>Begin 10-question interview</span>';
  uploadNote.textContent = `JD added · ${resume.name} · invite code entered`;
  uploadNote.classList.remove("error");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 4800);
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function verifyMicrophoneAccess() {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error("Microphone access is unavailable. Use a supported browser on HTTPS or localhost.");
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  try {
    if (!stream.getAudioTracks().length) throw new Error("No microphone was found. Connect a microphone and try again.");
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}

microphoneCheck.addEventListener("click", async () => {
  if (checkingMicrophone || connecting) return;
  checkingMicrophone = true;
  microphoneCheck.disabled = true;
  startButton.disabled = true;
  microphoneCheckStatus.textContent = "Waiting for microphone access. Select Allow if your browser asks.";
  try {
    await verifyMicrophoneAccess();
    microphoneCheckStatus.textContent = "Microphone access confirmed. Use headphones to reduce echo. You can begin when your details are ready.";
    microphoneCheck.textContent = "Check again";
  } catch (error) {
    microphoneCheckStatus.textContent = error.name === "NotAllowedError"
      ? "Microphone access was blocked. Allow it in your browser’s site settings, then check again."
      : error.message || "Could not access the microphone. Check your device and try again.";
  } finally {
    checkingMicrophone = false;
    microphoneCheck.disabled = false;
    updateUploadState();
  }
});

function setStatus(message, { active = false, speaking = false } = {}) {
  statusText.textContent = message;
  statusLight.classList.toggle("connected", active);
  visualizer.classList.toggle("connected", active);
  visualizer.classList.toggle("speaking", speaking);
  caption.textContent = speaking ? "YOUR INTERVIEWER IS SPEAKING" : active ? "LISTENING, TAKE YOUR TIME" : "YOUR VOICE, WHEN YOU’RE READY";
}

function appendTranscript(text, speaker = "Interviewer") {
  if (typeof text !== "string" || !text.trim()) return;
  conversationLog.push({ speaker, text });
  const placeholder = transcript.querySelector(".transcript-placeholder");
  placeholder?.remove();
  const line = document.createElement("p");
  const label = document.createElement("strong");
  label.textContent = `${speaker}: `;
  line.append(label, document.createTextNode(text));
  transcript.append(line);
  transcript.scrollTop = transcript.scrollHeight;
}

function validScorecard(scorecard) {
  const categories = [
    ["technical_accuracy", "Technical accuracy"],
    ["problem_solving", "Problem solving"],
    ["communication", "Communication"],
    ["role_relevance", "Role relevance"],
  ];
  if (!scorecard?.ratings || categories.some(([key]) =>
    scorecard.ratings[key] !== null && (!Number.isInteger(scorecard.ratings[key])
      || scorecard.ratings[key] < 1 || scorecard.ratings[key] > 5),
  ) || (scorecard.overall !== null && (typeof scorecard.overall !== "number" || !Number.isFinite(scorecard.overall)))
    || !Array.isArray(scorecard.strengths) || scorecard.strengths.length > 2
    || scorecard.strengths.some((item) => typeof item !== "string")
    || (scorecard.improvement !== null && typeof scorecard.improvement !== "string")
    || typeof scorecard.is_partial !== "boolean") return false;
  return true;
}

async function openScorecardPage(scorecard) {
  if (!validScorecard(scorecard)) {
    endingInterview = false;
    muteButton.disabled = false;
    startButton.disabled = false;
    startButton.innerHTML = '<span class="button-icon">×</span><span>Try scorecard again</span>';
    void room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
    setStatus("Connected · listening, take your time", { active: true });
    showToast("Could not display the scorecard. Try ending the interview again.");
    return;
  }

  try {
    sessionStorage.setItem("interviewScorecard", JSON.stringify({ ...scorecard, transcript: conversationLog }));
  } catch {
    pendingScorecard = scorecard;
    startButton.disabled = false;
    startButton.innerHTML = '<span>Open scorecard again</span>';
    setStatus("Scorecard ready · browser storage is blocked");
    connectionError.textContent = "Your scorecard is ready. Allow browser storage for this site, then select Open scorecard again. Keep this tab open.";
    connectionError.hidden = false;
    showToast("Could not open the scorecard page. Check your browser storage settings.");
    return;
  }
  pendingScorecard = null;
  scorecardDelivered = true;
  const activeRoom = room;
  room = undefined;
  try {
    if (activeRoom) await activeRoom.disconnect();
  } catch { /* Navigation still closes the room transport. */ }
  window.location.assign("/scorecard.html");
}

function formatElapsed() {
  if (!connectedAt) return;
  const total = Math.floor((Date.now() - connectedAt) / 1000);
  elapsed.textContent = `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

function closeRoom({ completed = false } = {}) {
  document.body.classList.remove("session-active");
  document.querySelector("#stage-label").textContent = "01 / PREPARE";
  clearInterval(timer);
  timer = undefined;
  connectedAt = undefined;
  const activeRoom = room;
  room = undefined;
  if (activeRoom) void activeRoom.disconnect().catch(() => {});
  conversationStarted = false;
  endingInterview = false;
  muted = false;
  connecting = false;
  muteButton.setAttribute("aria-pressed", "false");
  visualizer.classList.remove("muted");
  muteButton.innerHTML = '<span class="small-mic">◉</span><span>Mute mic</span>';
  muteButton.disabled = true;
  startButton.disabled = false;
  documentUpload.hidden = false;
  jobDescriptionInput.disabled = false;
  resumeInput.disabled = false;
  audioRecovery.hidden = true;
  document.querySelectorAll("audio[data-interview-audio]").forEach((audio) => audio.remove());
  interviewerHasSpoken = false;
  // Keep the candidate's preparation available after a connection failure.
  updateUploadState();
  elapsed.textContent = "00:00";
  setStatus(completed ? "Interview complete" : "Ready when you are");
}

async function connect() {
  if (connecting || checkingMicrophone) return;
  const inputs = selectedInputs();
  if (!inputs) return;
  connecting = true;
  conversationLog = [];
  pendingScorecard = null;
  connectionError.hidden = true;
  endingInterview = false;
  interviewerHasSpoken = false;
  scorecardDelivered = false;
  try { sessionStorage.removeItem("interviewScorecard"); } catch { /* Optional cleanup. */ }
  transcript.innerHTML = '<span class="transcript-placeholder">Your scorecard and conversation will appear here.</span>';
  startButton.disabled = true;
  startButton.innerHTML = "<span>Preparing interview…</span>";
  jobDescriptionInput.disabled = true;
  resumeInput.disabled = true;
  setStatus("Preparing your interview");
  try {
    setStatus("Checking microphone access");
    await verifyMicrophoneAccess();
    setStatus("Preparing your interview");
    const formData = new FormData();
    formData.append("job_description", inputs.jobDescription);
    formData.append("resume_pdf", inputs.resume);
    const detailsResponse = await fetchWithTimeout("/api/connection-details", {
      method: "POST",
      headers: { "X-Interview-Access-Code": inputs.accessCode },
      body: formData,
    });
    if (!detailsResponse.ok) {
      const error = await detailsResponse.json().catch(() => ({}));
      if (detailsResponse.status === 401) {
        accessCodeInput.setCustomValidity(error.detail || "Enter a valid demo access code.");
        accessCodeInput.reportValidity();
        accessCodeInput.focus();
      }
      throw new Error(error.detail || "Could not create a LiveKit session.");
    }
    const details = await detailsResponse.json();
    startButton.innerHTML = "<span>Connecting…</span>";
    setStatus("Connecting to your interviewer");
    room = new Room({ adaptiveStream: true, dynacast: true });
    const connectedRoom = room;
    room.on(RoomEvent.Disconnected, () => {
      if (room !== connectedRoom) return;
      const completed = scorecardDelivered;
      scorecardDelivered = false;
      closeRoom({ completed });
      showToast(completed ? "Your scorecard is ready." : "You’ve left the interview room.");
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === Track.Kind.Audio) {
        const audio = track.attach();
        audio.dataset.interviewAudio = "true";
        audio.autoplay = true;
        document.body.append(audio);
        void audio.play().catch(() => { audioRecovery.hidden = false; });
      }
      if (participant.isAgent && track.kind === Track.Kind.Audio) setStatus("Your interviewer is speaking", { active: true, speaking: true });
    });
    room.on(RoomEvent.TrackUnsubscribed, (track) => track.detach().forEach((element) => element.remove()));
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (participant.isAgent) setStatus("Your interviewer joined", { active: true });
    });
    room.on(RoomEvent.DataReceived, (payload, participant) => {
      try {
        const message = JSON.parse(new TextDecoder().decode(payload));
        if (message.type === "scorecard_complete" && participant?.isAgent) {
          void openScorecardPage(message.scorecard);
          return;
        }
        if (message.type === "scorecard_failed" && participant?.isAgent) {
          endingInterview = false;
          muteButton.disabled = false;
          startButton.disabled = false;
          startButton.innerHTML = '<span class="button-icon">×</span><span>Try scorecard again</span>';
          void room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
          setStatus("Connected · listening, take your time", { active: true });
          showToast("Could not finish your scorecard. Try ending the interview again.");
          return;
        }
        const text = message.text || message.alternatives?.[0]?.text;
        if (text && (message.type?.includes("transcription") || message.type?.includes("transcript"))) {
          appendTranscript(text, participant?.isAgent ? "Interviewer" : "You");
        }
      } catch { /* Ignore unrelated room data messages. */ }
    });
    room.on(RoomEvent.TranscriptionReceived, (segments, participant) => {
      for (const segment of segments) {
        if (segment.final && segment.text) {
          appendTranscript(segment.text, participant?.isAgent ? "Interviewer" : "You");
        }
      }
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (endingInterview) return;
      const agentSpeaking = speakers.some((participant) => participant.isAgent);
      if (agentSpeaking) interviewerHasSpoken = true;
      setStatus(agentSpeaking ? "Your interviewer is speaking" : muted ? "Microphone muted" : interviewerHasSpoken ? "Listening, take your time" : "Waiting for your interviewer’s welcome", { active: true, speaking: agentSpeaking });
    });
    room.on(RoomEvent.MediaDevicesError, (error) => showToast(`Microphone access failed: ${error.message}`));

    await room.connect(details.serverUrl, details.participantToken);
    await room.localParticipant.setMicrophoneEnabled(true);
    connectedAt = Date.now();
    timer = setInterval(formatElapsed, 1000);
    documentUpload.hidden = true;
    document.body.classList.add("session-active");
    document.querySelector("#stage-label").textContent = "02 / CONVERSATION";
    muteButton.disabled = false;
    startButton.innerHTML = '<span class="button-icon">×</span><span>End &amp; get scorecard</span>';
    startButton.disabled = false;
    setStatus("Connected · waiting for your interviewer", { active: true });
    conversationStarted = true;
    connecting = false;
    startButton.innerHTML = '<span class="button-icon">×</span><span>End &amp; get scorecard</span>';
    showToast("You’re in. Your interviewer will join shortly.");
  } catch (error) {
    console.error(error);
    closeRoom();
    const message = error.name === "AbortError"
      ? "Preparing the interview took too long. Your details are still here. Check your connection and try again; a demo attempt may already have been counted."
      : error.name === "NotAllowedError"
      ? "Microphone access was blocked. Allow microphone access in your browser’s site settings, then try again."
      : error.message || "Could not connect. Please try again.";
    connectionError.textContent = message;
    connectionError.hidden = false;
    showToast(message);
  }
}

async function requestInterviewEnd() {
  if (!room || !conversationStarted || endingInterview) return;
  endingInterview = true;
  startButton.disabled = true;
  startButton.innerHTML = "<span>Generating your scorecard…</span>";
  muteButton.disabled = true;
  setStatus("Preparing a scorecard from your interview", { active: true });
  try {
    await room.localParticipant.setMicrophoneEnabled(false);
    await room.localParticipant.publishData(
      new TextEncoder().encode(JSON.stringify({ type: "end_interview" })),
      { reliable: true, topic: "interview-control" },
    );
  } catch (error) {
    endingInterview = false;
    muteButton.disabled = false;
    startButton.disabled = false;
    startButton.innerHTML = '<span class="button-icon">×</span><span>End &amp; get scorecard</span>';
    void room?.localParticipant.setMicrophoneEnabled(!muted).catch(() => {});
    setStatus("Connected · listening, take your time", { active: true });
    showToast(error.message || "Could not request your scorecard. Try again.");
  }
}

startButton.addEventListener("click", () => {
  if (pendingScorecard) {
    void openScorecardPage(pendingScorecard);
    return;
  }
  if (room && conversationStarted) {
    void requestInterviewEnd();
  } else if (!room) {
    connect();
  }
});

muteButton.addEventListener("click", async () => {
  if (!room) return;
  muted = !muted;
  try {
    await room.localParticipant.setMicrophoneEnabled(!muted);
    visualizer.classList.toggle("muted", muted);
    muteButton.setAttribute("aria-pressed", String(muted));
    muteButton.innerHTML = muted ? '<span class="small-mic">◉</span><span>Unmute mic</span>' : '<span class="small-mic">◉</span><span>Mute mic</span>';
    setStatus(muted ? "Microphone muted" : "Listening, take your time", { active: true });
  } catch (error) {
    muted = !muted;
    showToast(error.message || "Could not change microphone state.");
  }
});

document.querySelector("#help-button").addEventListener("click", () => {
  document.querySelector("#help-dialog").showModal();
});

audioRecovery.addEventListener("click", async () => {
  const results = await Promise.allSettled([...document.querySelectorAll("audio")].map((audio) => audio.play()));
  const failed = results.some((result) => result.status === "rejected");
  audioRecovery.hidden = !failed;
  if (failed) showToast("Audio is still blocked. Check your browser’s sound permissions for this site.");
});

jobDescriptionInput.addEventListener("input", updateUploadState);
accessCodeInput.addEventListener("input", () => {
  accessCodeInput.setCustomValidity("");
  updateUploadState();
});
resumeInput.addEventListener("change", updateUploadState);

const rememberJD = document.querySelector("#remember-jd");
const draftStatus = document.querySelector("#draft-status");
const JD_DRAFT_KEY = "fieldnote.jd-draft.v1";
let draftTimer;

function saveJobDescriptionDraft() {
  clearTimeout(draftTimer);
  try {
    if (rememberJD.checked) {
      localStorage.setItem(JD_DRAFT_KEY, jobDescriptionInput.value.slice(0, 12000));
      draftStatus.textContent = "JD saved on this device. Resume and access code are not saved.";
    } else {
      localStorage.removeItem(JD_DRAFT_KEY);
      draftStatus.textContent = "No saved JD draft. Your current text stays in this form.";
    }
  } catch {
    draftStatus.textContent = "Browser storage is unavailable. Keep this tab open to retain your JD.";
  }
}

rememberJD.addEventListener("change", saveJobDescriptionDraft);
jobDescriptionInput.addEventListener("input", () => {
  if (rememberJD.checked) {
    clearTimeout(draftTimer);
    draftTimer = setTimeout(saveJobDescriptionDraft, 500);
  }
});
jobDescriptionInput.addEventListener("blur", () => {
  if (rememberJD.checked) saveJobDescriptionDraft();
});
document.querySelector("#forget-jd").addEventListener("click", () => {
  rememberJD.checked = false;
  saveJobDescriptionDraft();
});
try {
  const draft = localStorage.getItem(JD_DRAFT_KEY);
  if (draft !== null) {
    jobDescriptionInput.value = draft.slice(0, 12000);
    rememberJD.checked = true;
    draftStatus.textContent = "Your saved JD was restored. Upload your resume and enter your invite code to continue.";
  }
} catch { /* Draft storage is optional; interview setup remains available. */ }

const clock = document.querySelector("#clock");
function updateClock() {
  clock.textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()) + " LOCAL";
}
updateClock();
setInterval(updateClock, 30_000);

updateUploadState();
