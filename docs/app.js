/**
 * News Tracker Dashboard Application
 * Plain JavaScript (ES6+), zero frameworks, mobile-first design.
 */

// ==============================================================================
// State Management & Constants
// ==============================================================================

const STORAGE_KEYS = {
  THEME: "news_tracker_theme",
  SELECTED: "news_tracker_selected_stories",
  USED: "news_tracker_used_stories",
};

// Application State
let appData = {
  generated_at: "",
  total_stories: 0,
  stories: [],
};

let currentFilter = {
  searchQuery: "",
  topic: "all",
  sortBy: "score",
  showUsed: false,
};

// Sets for persistence
let selectedStoryIds = new Set();
let usedStoryIds = new Set();

// ==============================================================================
// Initialization & Lifecycle
// ==============================================================================

document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  loadSavedPreferences();
  initEventHandlers();
  fetchTrendingData();
});

/**
 * Load persisted selections, used stories, and theme from localStorage.
 */
function loadSavedPreferences() {
  try {
    const savedSelected = JSON.parse(localStorage.getItem(STORAGE_KEYS.SELECTED) || "[]");
    selectedStoryIds = new Set(savedSelected);

    const savedUsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.USED) || "[]");
    usedStoryIds = new Set(savedUsed);
  } catch (e) {
    console.warn("Could not load localStorage preferences:", e);
    selectedStoryIds = new Set();
    usedStoryIds = new Set();
  }
}

/**
 * Persist sets to localStorage.
 */
function savePreferences() {
  try {
    localStorage.setItem(STORAGE_KEYS.SELECTED, JSON.stringify([...selectedStoryIds]));
    localStorage.setItem(STORAGE_KEYS.USED, JSON.stringify([...usedStoryIds]));
  } catch (e) {
    console.warn("Could not save to localStorage:", e);
  }
}

/**
 * Generate a deterministic ID for a story from its title.
 */
function getStoryId(story) {
  if (!story || !story.title) return "";
  return story.title.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ==============================================================================
// Theme Management (Light / Dark Mode)
// ==============================================================================

function initTheme() {
  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
  if (savedTheme) {
    document.documentElement.setAttribute("data-theme", savedTheme);
  } else {
    // Respect OS preference by default
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", prefersDark ? "dark" : "light");
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute("data-theme") || "light";
  const nextTheme = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", nextTheme);
  localStorage.setItem(STORAGE_KEYS.THEME, nextTheme);
}

// ==============================================================================
// Data Fetching
// ==============================================================================

async function fetchTrendingData() {
  const refreshIcon = document.querySelector(".refresh-icon");
  if (refreshIcon) refreshIcon.classList.add("spinning");

  const candidates = [
    "trending.json",
    "data/trending.json",
    "../output/trending.json",
    "output/trending.json"
  ];

  let loadedData = null;
  let lastError = null;

  for (const path of candidates) {
    try {
      // Append cache-buster timestamp
      const response = await fetch(`${path}?t=${Date.now()}`);
      if (response.ok) {
        loadedData = await response.json();
        break;
      }
    } catch (err) {
      lastError = err;
    }
  }

  if (refreshIcon) refreshIcon.classList.remove("spinning");

  if (!loadedData || !Array.isArray(loadedData.stories)) {
    console.error("Failed to load trending data:", lastError);
    showErrorState("Could not load output/trending.json. Please check that tracker.py has run.");
    return;
  }

  appData = loadedData;
  hideErrorState();
  updateHeaderMetadata();
  buildTopicFilterChips();
  renderStories();
}

// ==============================================================================
// Date & Time Formatting Utilities
// ==============================================================================

/**
 * Convert relative time into clean user-friendly labels (e.g. '2h ago').
 */
function formatTimeAgo(dateStr) {
  if (!dateStr) return "";
  let dateObj = new Date(dateStr);
  if (isNaN(dateObj.getTime())) {
    // Attempt parsing 'YYYY-MM-DD HH:MM UTC'
    dateObj = new Date(dateStr.replace(" UTC", "Z").replace(" ", "T"));
  }
  if (isNaN(dateObj.getTime())) return dateStr;

  const now = new Date();
  const diffMs = now - dateObj;
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  return dateObj.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function updateHeaderMetadata() {
  const lastUpdatedEl = document.getElementById("lastUpdated");
  if (!lastUpdatedEl) return;

  if (appData.generated_at) {
    lastUpdatedEl.textContent = `Updated: ${appData.generated_at}`;
  } else {
    lastUpdatedEl.textContent = "Latest briefing ready";
  }
}

// ==============================================================================
// Topic Filter Chips
// ==============================================================================

function buildTopicFilterChips() {
  const topicsBar = document.getElementById("topicsBar");
  if (!topicsBar) return;

  // Calculate story counts per topic
  const counts = { all: appData.stories.length };
  appData.stories.forEach((story) => {
    const raw = (story.topic || "general").toLowerCase();
    counts[raw] = (counts[raw] || 0) + 1;
  });

  const uniqueTopics = Object.keys(counts).filter((t) => t !== "all");

  let html = `
    <button class="topic-chip ${currentFilter.topic === "all" ? "active" : ""}" data-topic="all">
      All (${counts.all})
    </button>
  `;

  uniqueTopics.sort().forEach((topicKey) => {
    const label = formatTopicLabel(topicKey);
    const count = counts[topicKey] || 0;
    const isActive = currentFilter.topic === topicKey ? "active" : "";
    html += `
      <button class="topic-chip ${isActive}" data-topic="${topicKey}">
        ${label} (${count})
      </button>
    `;
  });

  topicsBar.innerHTML = html;

  // Add click events to topic chips
  topicsBar.querySelectorAll(".topic-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const topic = chip.getAttribute("data-topic");
      currentFilter.topic = topic;
      topicsBar.querySelectorAll(".topic-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      renderStories();
    });
  });
}

function formatTopicLabel(topicKey) {
  return topicKey
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ==============================================================================
// Stories Rendering
// ==============================================================================

function renderStories() {
  const feed = document.getElementById("storiesFeed");
  const emptyState = document.getElementById("emptyState");
  const visibleCountBadge = document.getElementById("visibleCountBadge");
  const usedCountEl = document.getElementById("usedCount");

  if (!feed) return;

  // Update used stories count badge in header
  if (usedCountEl) {
    usedCountEl.textContent = usedStoryIds.size;
  }

  // Filter stories
  let filtered = appData.stories.filter((story) => {
    const id = getStoryId(story);
    const isUsed = usedStoryIds.has(id);

    // Hide used stories unless toggle is enabled
    if (isUsed && !currentFilter.showUsed) {
      return false;
    }

    // Filter by topic
    if (currentFilter.topic !== "all") {
      const storyTopic = (story.topic || "").toLowerCase();
      if (storyTopic !== currentFilter.topic.toLowerCase()) {
        return false;
      }
    }

    // Filter by headline search query
    if (currentFilter.searchQuery) {
      const q = currentFilter.searchQuery.toLowerCase();
      const titleMatch = (story.title || "").toLowerCase().includes(q);
      const sourceMatch = (story.sources || []).some((s) => s.name.toLowerCase().includes(q));
      if (!titleMatch && !sourceMatch) {
        return false;
      }
    }

    return true;
  });

  // Sort stories
  filtered.sort((a, b) => {
    if (currentFilter.sortBy === "newest") {
      const dateA = new Date(a.published_at || 0).getTime();
      const dateB = new Date(b.published_at || 0).getTime();
      return dateB - dateA;
    }
    if (currentFilter.sortBy === "sources") {
      return (b.source_count || 0) - (a.source_count || 0);
    }
    // Default: score
    return (b.score || 0) - (a.score || 0);
  });

  // Update visible count badge
  if (visibleCountBadge) {
    visibleCountBadge.textContent = `Showing ${filtered.length} of ${appData.stories.length}`;
  }

  // Handle empty state
  if (filtered.length === 0) {
    feed.innerHTML = "";
    if (emptyState) emptyState.classList.remove("hidden");
    updateSelectionBar();
    return;
  }

  if (emptyState) emptyState.classList.add("hidden");

  // Determine maximum score in dataset for score meter calculation
  const maxScore = Math.max(...appData.stories.map((s) => s.score || 10), 50);

  // Render cards
  const cardsHtml = filtered.map((story) => {
    const id = getStoryId(story);
    const isSelected = selectedStoryIds.has(id);
    const isUsed = usedStoryIds.has(id);
    const topicLabel = formatTopicLabel(story.topic || "General");
    const sourceCount = story.source_count || story.sources?.length || 1;
    const timeAgo = formatTimeAgo(story.published_at);
    const scoreVal = (story.score || 0).toFixed(1);
    const scorePercent = Math.min(100, Math.max(10, Math.round((story.score / maxScore) * 100)));

    // Generate source links chips
    const sourceChips = (story.sources || []).map((source) => {
      return `
        <a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer" class="source-chip" title="Read on ${escapeHtml(source.name)}">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
          </svg>
          <span>${escapeHtml(source.name)}</span>
        </a>
      `;
    }).join("");

    return `
      <article class="story-card ${isSelected ? "is-selected" : ""} ${isUsed ? "is-used" : ""}" data-story-id="${id}">
        <!-- Top Metadata Row -->
        <div class="card-meta-row">
          <div class="meta-badges-left">
            <span class="topic-tag">${escapeHtml(topicLabel)}</span>
            <span class="sources-count-badge">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              ${sourceCount} ${sourceCount === 1 ? "source" : "sources"}
            </span>
            ${isUsed ? `<span class="used-badge">Used</span>` : ""}
          </div>
          <span class="time-ago">${timeAgo}</span>
        </div>

        <!-- Headline -->
        <h2 class="story-headline">${escapeHtml(story.title)}</h2>

        <!-- Score Bar -->
        <div class="score-row">
          <span class="score-label">Score: ${scoreVal}</span>
          <div class="score-bar-track" title="Trending score: ${scoreVal}">
            <div class="score-bar-fill" style="width: ${scorePercent}%;"></div>
          </div>
        </div>

        <!-- Sources -->
        <div class="sources-container">
          <span class="sources-label">Coverage</span>
          <div class="sources-chips-list">
            ${sourceChips}
          </div>
        </div>

        <!-- Card Footer Actions -->
        <div class="card-actions-row">
          <button class="select-toggle-btn" data-action="toggle-select" data-story-id="${id}">
            <span class="custom-checkbox">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            </span>
            <span>${isSelected ? "Selected" : "Select"}</span>
          </button>

          <button class="used-toggle-btn" data-action="toggle-used" data-story-id="${id}" title="${isUsed ? "Mark as unused" : "Mark as used"}">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
              <polyline points="22 4 12 14.01 9 11.01"></polyline>
            </svg>
            <span>${isUsed ? "Mark Unused" : "Mark Used"}</span>
          </button>
        </div>
      </article>
    `;
  }).join("");

  feed.innerHTML = cardsHtml;
  updateSelectionBar();
}

// ==============================================================================
// Selection & Clipboard Actions
// ==============================================================================

function updateSelectionBar() {
  const bar = document.getElementById("selectionBar");
  const countText = document.getElementById("selectedCountText");
  if (!bar || !countText) return;

  const count = selectedStoryIds.size;
  if (count > 0) {
    countText.textContent = `${count} ${count === 1 ? "story" : "stories"} selected`;
    bar.classList.remove("hidden");
  } else {
    bar.classList.add("hidden");
  }
}

function toggleStorySelection(storyId) {
  if (selectedStoryIds.has(storyId)) {
    selectedStoryIds.delete(storyId);
  } else {
    selectedStoryIds.add(storyId);
  }
  savePreferences();
  renderStories();
}

function toggleStoryUsed(storyId) {
  if (usedStoryIds.has(storyId)) {
    usedStoryIds.delete(storyId);
    showToast("Story marked as unused");
  } else {
    usedStoryIds.add(storyId);
    // When marking used, remove from selected if it was selected
    selectedStoryIds.delete(storyId);
    showToast("Story marked as used");
  }
  savePreferences();
  renderStories();
}

function clearAllSelections() {
  selectedStoryIds.clear();
  savePreferences();
  renderStories();
  showToast("All selections cleared");
}

function markSelectedAsUsed() {
  if (selectedStoryIds.size === 0) return;
  selectedStoryIds.forEach((id) => usedStoryIds.add(id));
  const count = selectedStoryIds.size;
  selectedStoryIds.clear();
  savePreferences();
  renderStories();
  showToast(`Marked ${count} ${count === 1 ? "story" : "stories"} as used`);
}

/**
 * Copy selected stories to clipboard with clean markdown links.
 */
function copySelectedStories() {
  if (selectedStoryIds.size === 0) return;

  const selectedList = appData.stories.filter((story) => selectedStoryIds.has(getStoryId(story)));

  if (selectedList.length === 0) return;

  const formattedLines = selectedList.map((story, idx) => {
    const sourcesStr = (story.sources || [])
      .map((s) => `  - ${s.name}: ${s.url}`)
      .join("\n");
    return `${idx + 1}. ${story.title} [${story.source_count || story.sources?.length} sources]\n${sourcesStr}`;
  });

  const fullText = formattedLines.join("\n\n");

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(fullText).then(() => {
      showToast(`Copied ${selectedList.length} stories to clipboard!`);
    }).catch((err) => {
      fallbackCopyToClipboard(fullText);
    });
  } else {
    fallbackCopyToClipboard(fullText);
  }
}

function fallbackCopyToClipboard(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand("copy");
    showToast("Copied to clipboard!");
  } catch (err) {
    showToast("Failed to copy. Please allow clipboard permissions.");
  }
  document.body.removeChild(textarea);
}

// ==============================================================================
// User Feedback & Notifications
// ==============================================================================

let toastTimer = null;
function showToast(message) {
  const toast = document.getElementById("toastNotification");
  const toastMessage = document.getElementById("toastMessage");
  if (!toast || !toastMessage) return;

  toastMessage.textContent = message;
  toast.classList.remove("hidden");

  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2800);
}

function showErrorState(message) {
  const errorCard = document.getElementById("errorState");
  const errorMsg = document.getElementById("errorMessage");
  const feed = document.getElementById("storiesFeed");
  if (errorCard && errorMsg) {
    errorMsg.textContent = message;
    errorCard.classList.remove("hidden");
    if (feed) feed.innerHTML = "";
  }
}

function hideErrorState() {
  const errorCard = document.getElementById("errorState");
  if (errorCard) errorCard.classList.add("hidden");
}

function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// ==============================================================================
// Event Listeners
// ==============================================================================

function initEventHandlers() {
  // Theme Toggle Button
  const themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", toggleTheme);
  }

  // Refresh Button
  const refreshBtn = document.getElementById("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchTrendingData();
      showToast("Refreshed latest stories");
    });
  }

  // Search Input
  const searchInput = document.getElementById("searchInput");
  const searchClearBtn = document.getElementById("searchClearBtn");

  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      currentFilter.searchQuery = e.target.value.trim();
      if (searchClearBtn) {
        searchClearBtn.style.display = currentFilter.searchQuery ? "block" : "none";
      }
      renderStories();
    });
  }

  if (searchClearBtn && searchInput) {
    searchClearBtn.addEventListener("click", () => {
      searchInput.value = "";
      currentFilter.searchQuery = "";
      searchClearBtn.style.display = "none";
      renderStories();
      searchInput.focus();
    });
  }

  // Sort Dropdown
  const sortSelect = document.getElementById("sortSelect");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      currentFilter.sortBy = e.target.value;
      renderStories();
    });
  }

  // Show Used Stories Toggle
  const showUsedToggle = document.getElementById("showUsedToggle");
  if (showUsedToggle) {
    showUsedToggle.addEventListener("change", (e) => {
      currentFilter.showUsed = e.target.checked;
      renderStories();
    });
  }

  // Story Feed Delegation (Card action buttons)
  const storiesFeed = document.getElementById("storiesFeed");
  if (storiesFeed) {
    storiesFeed.addEventListener("click", (e) => {
      const selectBtn = e.target.closest("[data-action='toggle-select']");
      if (selectBtn) {
        const storyId = selectBtn.getAttribute("data-story-id");
        toggleStorySelection(storyId);
        return;
      }

      const usedBtn = e.target.closest("[data-action='toggle-used']");
      if (usedBtn) {
        const storyId = usedBtn.getAttribute("data-story-id");
        toggleStoryUsed(storyId);
        return;
      }
    });
  }

  // Selection Action Bar Buttons
  const copyBtn = document.getElementById("copySelectedBtn");
  if (copyBtn) copyBtn.addEventListener("click", copySelectedStories);

  const clearBtn = document.getElementById("clearSelectionBtn");
  if (clearBtn) clearBtn.addEventListener("click", clearAllSelections);

  const markUsedBtn = document.getElementById("markSelectedUsedBtn");
  if (markUsedBtn) markUsedBtn.addEventListener("click", markSelectedAsUsed);

  // Empty State Reset Button
  const resetBtn = document.getElementById("resetFiltersBtn");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      if (searchInput) {
        searchInput.value = "";
        currentFilter.searchQuery = "";
      }
      currentFilter.topic = "all";
      const topicsBar = document.getElementById("topicsBar");
      if (topicsBar) {
        topicsBar.querySelectorAll(".topic-chip").forEach((c) => {
          c.classList.toggle("active", c.getAttribute("data-topic") === "all");
        });
      }
      renderStories();
    });
  }

  // Retry Button on Error State
  const retryBtn = document.getElementById("retryLoadBtn");
  if (retryBtn) {
    retryBtn.addEventListener("click", fetchTrendingData);
  }
}

