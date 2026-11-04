# News Tracker & Live Dashboard 📰

A lightweight, automated Python tool and modern web dashboard that monitors trending stories across business, marketing and brand campaigns, startups, and technology news from reliable RSS feeds, clustering multiple reports about the same event into a daily shortlist.

Designed for beginners: simple code, clearly commented, mobile-first responsive dashboard, and completely customizable without touching Python code.

---

## 📁 Project Structure

| File / Folder | Description |
| :--- | :--- |
| **`sources.yaml`** | List of verified RSS feed URLs organized by topic. |
| **`config.yaml`** | Non-technical settings: lookback window, shortlist size, similarity threshold, and keywords. |
| **`tracker.py`** | The main Python script that fetches feeds, clusters headlines, scores stories, and saves outputs. |
| **`seen.json`** | History of already-reported stories so you never see the same story twice within the retention window. |
| **`output/trending.md`** | Daily briefing in clean, human-readable Markdown with direct links to every source. |
| **`output/trending.json`** | Machine-readable results with titles, scores, timestamps, and sources. |
| **`docs/`** | **Modern Static Dashboard** (HTML, CSS, JS) that serves on GitHub Pages or locally. |
| ├── `docs/index.html` | Dashboard layout and structure (mobile-first, semantic). |
| ├── `docs/style.css` | Card layout, dark/light theme, score bars, responsive controls. |
| ├── `docs/app.js` | Fetching, search, topic filters, sorting, selection bar, clipboard copy, and localStorage. |
| └── `docs/trending.json`| Synchronized copy of latest trending data for the dashboard. |
| **`.github/workflows/run.yml`** | Automated GitHub Actions workflow that runs every 3 hours, updates data, and deploys to GitHub Pages. |
| **`requirements.txt`** | Python dependencies needed to run the project. |

---

## 📱 Dashboard Features

- **Mobile-First Responsive Card Layout:** Large touch targets, soft shadows, rounded corners, clean Google Fonts (*Plus Jakarta Sans*).
- **Dark & Light Mode:** Automatically respects your device theme with a manual switch in the header (persisted in `localStorage`).
- **Story Cards:** Displays topic tags, distinct source count badge (e.g. `3 sources`), time ago (`2h ago`), score meter bar, and clickable source chips.
- **Search & Filters:** Real-time search box, dynamic topic chips (`Business`, `Startups`, `Tech`, etc.), and sort dropdown (*Top Score*, *Newest*, *Most Sources*).
- **Selection & Clipboard Export:** Tap "Select" on any card. A sticky action bar at the bottom shows the count with a **"Copy Selected"** button that formats headlines and source links directly to your clipboard.
- **Used Stories Switch:** Mark stories as "Used" to hide them from the feed, with a toggle switch to show/hide used stories whenever needed.

---

## 🚀 Quick Start (Running Locally)

### 1. Set Up Environment & Run Tracker
Open your terminal in this project folder:

```bash
# Windows
.\.venv\Scripts\activate
python tracker.py

# macOS / Linux
source .venv/bin/activate
python3 tracker.py
```

### 2. View the Dashboard Locally
Because modern browsers restrict `fetch()` on `file://` URLs due to CORS security policies, serve the dashboard using Python's built-in web server:

```bash
python -m http.server 8000 --directory docs
```
Open **`http://localhost:8000`** in your browser (or phone on the same Wi-Fi network).

---

## 🌐 Deploying to GitHub Pages (Automatic Hosting)

The project includes an official GitHub Actions workflow (`.github/workflows/run.yml`) that runs the tracker every 3 hours and automatically deploys the `docs/` dashboard to GitHub Pages.

### Exactly Which GitHub Settings to Turn On:
1. Push this repository to GitHub:
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit of news tracker and dashboard"
   git remote add origin https://github.com/<your-username>/<your-repo-name>.git
   git push -u origin main
   ```
2. In your GitHub repository, click on **Settings** (top navigation tab).
3. In the left sidebar, click **Pages** (under the "Code and automation" section).
4. Under **Build and deployment** > **Source**:
   - Change the dropdown from "Deploy from a branch" to **GitHub Actions**.
5. That's it! 
   - Navigate to the **Actions** tab on your repository.
   - You can trigger the workflow immediately by clicking **News Tracker & Dashboard** > **Run workflow**.
   - Your site will deploy automatically.

### Live Dashboard URL:
Once deployed, your dashboard will be live at:
```
https://<your-username>.github.io/<your-repo-name>/
```

---

## ⚙️ How to Edit Configuration (`config.yaml`)

```yaml
# How many hours back in time to fetch articles (default: 48)
lookback_hours: 48

# Number of top trending stories to include in the daily shortlist (default: 10)
shortlist_size: 10

# Similarity threshold for grouping headlines about the same story (0.0 to 1.0)
similarity_threshold: 0.35

# How many days to keep stories in seen.json before removing them (default: 14)
seen_retention_days: 14

# Keywords that give stories a small boost in score
boost_keywords:
  - "india"
  - "funding"
  - "startup"
  - "ai"
  - "campaign"

# Keywords that penalize stories (crime, sensationalism)
penalty_keywords:
  - "crime"
  - "murder"
  - "violence"
  - "accident"
  - "rape"
```

---

## 📡 How to Add or Remove Feeds (`sources.yaml`)

To add an RSS feed, edit `sources.yaml`:
```yaml
tech:
  - name: "My Favorite Tech Blog"
    url: "https://example.com/feed.xml"
```

---

## 🛡️ Privacy & Compliance Notice
- **100% Free & Open**: No API keys, no analytics, no third-party tracking scripts.
- **RSS-only access**: No scraping forbidden sites.
- **Fair Use**: Stores and displays only headlines, source names, and outbound links.
