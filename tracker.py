"""
News Tracker: Finds trending news stories from RSS feeds and creates a daily shortlist.

This script performs the following steps:
1. Loads configuration from config.yaml and feed sources from sources.yaml.
2. Fetches articles from all configured RSS feeds with timeout and error handling.
3. Filters articles published within the lookback window (default: 48 hours).
4. Cleans headline titles and removes duplicate URLs.
5. Ignores sponsored content and opinion pieces if marked by the publisher.
6. Clusters similar headlines covering the same story using TF-IDF and cosine similarity.
7. Scores each story cluster based on:
   - Number of distinct sources (more sources = higher trending score)
   - Recency (newer stories receive a score boost)
   - Boost keywords (positive signals like 'india', 'funding', 'ai')
   - Penalty keywords (negative/crime signals like 'murder', 'accident')
8. Filters out stories already recorded in seen.json, and prunes seen records older
   than the configured retention days (default: 14 days).
9. Generates:
   - output/trending.json: Structured machine-readable results.
   - output/trending.md: A clean, human-readable markdown briefing with links.
"""

import os
import re
import json
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Tuple
import xml.etree.ElementTree as ET

import yaml
import requests
import feedparser
from dateutil import parser as date_parser
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# Configure logging for friendly, clear console messages
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("news-tracker")


# ==============================================================================
# Helper Functions: Loading Configuration & Data
# ==============================================================================

def load_yaml(filepath: str) -> Dict[str, Any]:
    """Load and parse a YAML file."""
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"Missing required file: {filepath}")
    with open(filepath, "r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def load_seen_stories(filepath: str, retention_days: int) -> Dict[str, Any]:
    """
    Load stories previously seen from seen.json and remove any entries
    that are older than the retention threshold.
    """
    if not os.path.exists(filepath):
        return {}

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            seen_data = json.load(f)
    except Exception as e:
        logger.warning(f"Could not read {filepath} ({e}), starting with empty seen records.")
        return {}

    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(days=retention_days)
    pruned_data = {}

    for key, item in seen_data.items():
        added_at_str = item.get("added_at")
        if added_at_str:
            try:
                added_at = datetime.fromisoformat(added_at_str)
                # Keep only items added within retention_days
                if added_at >= cutoff:
                    pruned_data[key] = item
                continue
            except Exception:
                pass
        # If no valid date found, keep it defensively
        pruned_data[key] = item

    return pruned_data


def save_seen_stories(filepath: str, seen_data: Dict[str, Any]) -> None:
    """Save the updated seen records to seen.json."""
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(seen_data, f, indent=2, ensure_ascii=False)


# ==============================================================================
# Text Cleaning & Normalization
# ==============================================================================

def clean_title(title: str) -> str:
    """
    Clean headline title:
    - Strips publisher suffixes (e.g., ' - The Economic Times', ' | TechCrunch').
    - Removes HTML tags or extra punctuation.
    - Normalizes extra whitespaces.
    """
    if not title:
        return ""

    # Remove HTML tags if present
    cleaned = re.sub(r"<[^>]+>", "", title)

    # Decode common HTML entities
    cleaned = (
        cleaned.replace("&amp;", "&")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&nbsp;", " ")
    )

    # Strip common site suffixes at the end of headlines (e.g. " - TechCrunch", " | Reuters")
    cleaned = re.sub(r"\s*[-|–—:]\s*(TechCrunch|The Verge|Ars Technica|Livemint|Economic Times|ET|Business Standard|BBC News|BBC|Adweek|Marketing Dive|Inc42|YourStory|Gadgets 360|MediaNama)\s*$", "", cleaned, flags=re.IGNORECASE)

    # Strip surrounding quotation marks and spaces
    cleaned = cleaned.strip(" '\"`“”‘’\t\r\n")
    return cleaned


def normalize_for_clustering(title: str) -> str:
    """
    Produce a normalized lowercase version of the title for TF-IDF clustering.
    Keeps alphanumeric characters and spaces.
    """
    clean = clean_title(title).lower()
    # Replace non-alphanumeric characters with spaces
    clean = re.sub(r"[^a-z0-9\s]", " ", clean)
    # Collapse multiple spaces into one
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def is_sponsored_or_opinion(entry: Dict[str, Any], title: str) -> bool:
    """
    Checks if an article is marked as sponsored, promoted, or an opinion column.
    """
    check_text = (title or "").lower()

    # Title prefix/content indicators
    disallowed_prefixes = ("opinion:", "opinion |", "sponsored:", "promoted:", "partner content:", "advertorial:")
    if any(check_text.startswith(prefix) for prefix in disallowed_prefixes):
        return True

    disallowed_phrases = ("sponsored by", "partnered with", "promoted post")
    if any(phrase in check_text for phrase in disallowed_phrases):
        return True

    # Check tags / categories in RSS entry if available
    tags = entry.get("tags", [])
    if isinstance(tags, list):
        for tag in tags:
            term = ""
            if isinstance(tag, dict):
                term = tag.get("term", "").lower()
            elif isinstance(tag, str):
                term = tag.lower()
            if term in ("sponsored", "opinion", "promoted", "advertorial", "partner-content"):
                return True

    return False


def parse_published_date(entry: Dict[str, Any]) -> datetime:
    """
    Extract and parse the publication date from an RSS entry into a UTC datetime.
    Falls back to current UTC time if date cannot be resolved.
    """
    # 1. Try feedparser's parsed struct_time
    time_struct = entry.get("published_parsed") or entry.get("updated_parsed")
    if time_struct:
        try:
            return datetime(*time_struct[:6], tzinfo=timezone.utc)
        except Exception:
            pass

    # 2. Try raw date strings with dateutil.parser
    raw_date = entry.get("published") or entry.get("updated") or entry.get("pubDate")
    if raw_date:
        try:
            dt = date_parser.parse(raw_date)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return dt.astimezone(timezone.utc)
        except Exception:
            pass

    # Fallback to current UTC time
    return datetime.now(timezone.utc)


# ==============================================================================
# RSS Fetching
# ==============================================================================

def fetch_feed_articles(
    topic: str,
    source_name: str,
    feed_url: str,
    lookback_hours: int,
    now_utc: datetime,
) -> List[Dict[str, Any]]:
    """
    Fetch articles from a single RSS feed.
    Returns a list of parsed article dictionaries within the lookback window.
    """
    articles = []
    cutoff_time = now_utc - timedelta(hours=lookback_hours)

    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/124.0.0.0 Safari/537.36 (NewsTracker/1.0; RSS reader)"
        ),
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
    }

    try:
        response = requests.get(feed_url, headers=headers, timeout=12)
        if response.status_code != 200:
            logger.warning(f"Feed [{source_name}] returned HTTP status {response.status_code}")
            return []

        parsed = feedparser.parse(response.content)
    except requests.RequestException as e:
        logger.warning(f"Network error fetching [{source_name}] ({feed_url}): {e}")
        return []
    except Exception as e:
        logger.warning(f"Error parsing feed [{source_name}]: {e}")
        return []

    if not parsed.entries:
        logger.info(f"Feed [{source_name}] returned 0 entries.")
        return []

    for entry in parsed.entries:
        raw_title = entry.get("title", "")
        title = clean_title(raw_title)
        link = entry.get("link", "").strip()

        if not title or not link:
            continue

        # Skip sponsored content or opinion pieces
        if is_sponsored_or_opinion(entry, title):
            continue

        published_at = parse_published_date(entry)

        # Filter by lookback window
        if published_at < cutoff_time:
            continue

        articles.append({
            "title": title,
            "normalized_title": normalize_for_clustering(title),
            "link": link,
            "source": source_name,
            "topic": topic,
            "published_at": published_at,
        })

    logger.info(f"Fetched {len(articles)} fresh articles from [{source_name}]")
    return articles


# ==============================================================================
# Clustering Similar Headlines
# ==============================================================================

def cluster_articles(articles: List[Dict[str, Any]], similarity_threshold: float) -> List[List[Dict[str, Any]]]:
    """
    Cluster articles covering the same story event using TF-IDF and Cosine Similarity.

    Algorithm:
    1. Transform normalized headlines into TF-IDF vectors.
    2. Compute pairwise cosine similarity between all headlines.
    3. Construct a graph where an edge exists if cosine similarity >= similarity_threshold.
    4. Group connected components into clusters using Breadth-First Search (BFS).
    """
    if not articles:
        return []
    if len(articles) == 1:
        return [[articles[0]]]

    headlines = [a["normalized_title"] for a in articles]

    # Convert headlines to TF-IDF feature vectors
    vectorizer = TfidfVectorizer(stop_words="english", max_features=5000)
    try:
        tfidf_matrix = vectorizer.fit_transform(headlines)
        sim_matrix = cosine_similarity(tfidf_matrix)
    except Exception as e:
        logger.warning(f"TF-IDF clustering fallback due to error: {e}")
        return [[a] for a in articles]

    n = len(articles)
    visited = [False] * n
    clusters = []

    for i in range(n):
        if visited[i]:
            continue

        # Start a new cluster using BFS
        cluster = []
        queue = [i]
        visited[i] = True

        while queue:
            curr = queue.pop(0)
            cluster.append(articles[curr])

            for neighbor in range(n):
                if not visited[neighbor] and sim_matrix[curr][neighbor] >= similarity_threshold:
                    visited[neighbor] = True
                    queue.append(neighbor)

        clusters.append(cluster)

    return clusters


# ==============================================================================
# Scoring Clusters
# ==============================================================================

def select_best_headline(cluster: List[Dict[str, Any]]) -> str:
    """
    Pick the cleanest, most representative headline in the cluster.
    Prefers titles with moderate length (avoiding very short clickbait or overly long titles).
    """
    titles = [a["title"] for a in cluster]
    # Score titles based on length between 40 and 95 characters
    def headline_suitability(t: str) -> int:
        length = len(t)
        if 40 <= length <= 95:
            return 100 - abs(length - 65)
        return -abs(length - 65)

    return max(titles, key=headline_suitability)


def score_cluster(
    cluster: List[Dict[str, Any]],
    boost_keywords: List[str],
    penalty_keywords: List[str],
    lookback_hours: int,
    now_utc: datetime,
) -> float:
    """
    Calculate the trending score for a cluster:
    1. Distinct sources: More distinct news outlets reporting on this story = higher score.
    2. Recency: Stories published more recently receive a higher score boost.
    3. Boost keywords: Small boost for high-value topics (funding, startups, launches, AI, India).
    4. Penalty keywords: Penalty for crime, accidents, sensational violence.
    """
    # 1. Distinct sources count
    distinct_sources = set(a["source"] for a in cluster)
    source_count = len(distinct_sources)
    # 1 source = 10 pts, 2 sources = 25 pts, 3 sources = 42 pts, 4+ = 60+ pts
    base_score = 10.0 * (source_count ** 1.3)

    # 2. Recency score (newer stories receive up to 5 points)
    most_recent_pub = max(a["published_at"] for a in cluster)
    age_hours = (now_utc - most_recent_pub).total_seconds() / 3600.0
    recency_factor = max(0.0, (lookback_hours - age_hours) / lookback_hours)
    recency_score = recency_factor * 5.0

    # Combine text of all headlines in the cluster for keyword evaluation
    combined_text = " ".join(a["normalized_title"] for a in cluster).lower()

    # 3. Boost keywords: +1.5 pts per unique matched keyword (up to +6.0)
    boost_score = 0.0
    for kw in boost_keywords:
        kw_norm = kw.lower().strip()
        if re.search(rf"\b{re.escape(kw_norm)}\b", combined_text):
            boost_score += 1.5
    boost_score = min(boost_score, 6.0)

    # 4. Penalty keywords: -15 pts per match for crime/violence
    penalty_score = 0.0
    for kw in penalty_keywords:
        kw_norm = kw.lower().strip()
        if re.search(rf"\b{re.escape(kw_norm)}\b", combined_text):
            penalty_score += 15.0

    total_score = base_score + recency_score + boost_score - penalty_score
    return round(total_score, 2)


# ==============================================================================
# Formatting & Saving Output
# ==============================================================================

def make_story_identifier(title: str) -> str:
    """Creates a normalized string key to detect duplicates across runs."""
    return re.sub(r"[^a-z0-9]", "", title.lower())


def save_trending_json(filepath: str, stories: List[Dict[str, Any]], now_utc: datetime) -> None:
    """Save the shortlist to output/trending.json."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    payload = {
        "generated_at": now_utc.strftime("%Y-%m-%d %H:%M:%S UTC"),
        "total_stories": len(stories),
        "stories": stories,
    }
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
    logger.info(f"Saved JSON results to {filepath}")


def save_trending_markdown(filepath: str, stories: List[Dict[str, Any]], now_utc: datetime) -> None:
    """Save the shortlist as readable markdown to output/trending.md."""
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    date_str = now_utc.strftime("%B %d, %Y at %H:%M UTC")
    lines = [
        "# Daily Trending News Shortlist",
        f"> **Generated on:** {date_str} | **Top Stories:** {len(stories)}",
        "",
        "---",
        "",
    ]

    if not stories:
        lines.append("_No new trending stories found within the lookback window._\n")
    else:
        for idx, story in enumerate(stories, 1):
            title = story["title"]
            source_count = story["source_count"]
            topic = story["topic"].replace("_", " ").title()
            pub_time = story["published_at"]
            score = story["score"]

            # Format clickable source links: [Source Name](URL)
            source_links = [f"[{s['name']}]({s['url']})" for s in story["sources"]]
            sources_formatted = " • ".join(source_links)

            plural = "sources" if source_count != 1 else "source"
            lines.append(f"### {idx}. {title} [{source_count} {plural}]")
            lines.append(f"- **Topic:** `{topic}` | **Score:** `{score}` | **Published:** {pub_time}")
            lines.append(f"- **Coverage:** {sources_formatted}")
            lines.append("")

    with open(filepath, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    logger.info(f"Saved Markdown results to {filepath}")


# ==============================================================================
# Main Orchestrator
# ==============================================================================

def run_tracker():
    """Main execution entry point."""
    logger.info("Starting News Tracker...")

    # Load configuration
    config = load_yaml("config.yaml")
    lookback_hours = config.get("lookback_hours", 48)
    shortlist_size = config.get("shortlist_size", 10)
    similarity_threshold = config.get("similarity_threshold", 0.35)
    seen_retention_days = config.get("seen_retention_days", 14)
    boost_keywords = config.get("boost_keywords", [])
    penalty_keywords = config.get("penalty_keywords", [])

    # Load sources
    sources_data = load_yaml("sources.yaml")

    now_utc = datetime.now(timezone.utc)
    all_articles = []
    seen_links = set()

    # Step 1 & 2: Fetch feeds and collect fresh articles
    for topic, feed_list in sources_data.items():
        if not isinstance(feed_list, list):
            continue
        for feed in feed_list:
            feed_name = feed.get("name", "Unknown Source")
            feed_url = feed.get("url", "")
            if not feed_url:
                continue

            feed_articles = fetch_feed_articles(
                topic=topic,
                source_name=feed_name,
                feed_url=feed_url,
                lookback_hours=lookback_hours,
                now_utc=now_utc,
            )

            # Step 3: Remove duplicate links across feeds
            for art in feed_articles:
                link = art["link"]
                if link not in seen_links:
                    seen_links.add(link)
                    all_articles.append(art)

    logger.info(f"Total unique articles collected across all feeds: {len(all_articles)}")

    if not all_articles:
        logger.warning("No articles fetched. Check your internet connection or feed URLs.")
        save_trending_json("output/trending.json", [], now_utc)
        save_trending_markdown("output/trending.md", [], now_utc)
        return

    # Step 4: Cluster similar headlines using TF-IDF and Cosine Similarity
    clusters = cluster_articles(all_articles, similarity_threshold=similarity_threshold)
    logger.info(f"Grouped articles into {len(clusters)} story clusters.")

    # Step 5: Score each cluster
    scored_clusters = []
    for cluster in clusters:
        score = score_cluster(
            cluster=cluster,
            boost_keywords=boost_keywords,
            penalty_keywords=penalty_keywords,
            lookback_hours=lookback_hours,
            now_utc=now_utc,
        )

        # Ignore clusters that have a heavily negative score (penalty filtered)
        if score <= 0:
            continue

        best_title = select_best_headline(cluster)
        most_recent_pub = max(a["published_at"] for a in cluster)

        # Build list of distinct sources with their respective links
        sources_seen = set()
        sources_list = []
        for a in cluster:
            if a["source"] not in sources_seen:
                sources_seen.add(a["source"])
                sources_list.append({"name": a["source"], "url": a["link"]})

        # Predominant topic is taken from the majority in the cluster
        topic = cluster[0]["topic"]

        scored_clusters.append({
            "title": best_title,
            "score": score,
            "source_count": len(sources_list),
            "published_at": most_recent_pub.strftime("%Y-%m-%d %H:%M UTC"),
            "topic": topic,
            "sources": sources_list,
            "cluster_articles": cluster,
        })

    # Sort clusters descending by score
    scored_clusters.sort(key=lambda x: x["score"], reverse=True)

    # Step 6: Filter out already seen stories, and update seen.json
    seen_file = "seen.json"
    seen_records = load_seen_stories(seen_file, retention_days=seen_retention_days)

    shortlist = []
    for item in scored_clusters:
        key = make_story_identifier(item["title"])
        # Check if the title or any article link was already shown
        is_seen = (key in seen_records)
        if not is_seen:
            for s in item["sources"]:
                if s["url"] in seen_records:
                    is_seen = True
                    break

        if not is_seen:
            shortlist.append(item)
            if len(shortlist) >= shortlist_size:
                break

    logger.info(f"Selected {len(shortlist)} top stories for the shortlist.")

    # Record shortlisted stories in seen.json
    now_iso = now_utc.isoformat()
    for item in shortlist:
        key = make_story_identifier(item["title"])
        seen_records[key] = {
            "title": item["title"],
            "published_at": item["published_at"],
            "added_at": now_iso,
        }
        for s in item["sources"]:
            seen_records[s["url"]] = {
                "title": item["title"],
                "added_at": now_iso,
            }

    save_seen_stories(seen_file, seen_records)

    # Step 7 & 8: Save top stories to output/trending.json and output/trending.md
    output_stories = [
        {
            "title": item["title"],
            "score": item["score"],
            "source_count": item["source_count"],
            "published_at": item["published_at"],
            "topic": item["topic"],
            "sources": item["sources"],
        }
        for item in shortlist
    ]

    save_trending_json("output/trending.json", output_stories, now_utc)
    save_trending_markdown("output/trending.md", output_stories, now_utc)
    # Also save a copy for the static dashboard in docs/
    save_trending_json("docs/trending.json", output_stories, now_utc)

    logger.info("News Tracker finished successfully!")


if __name__ == "__main__":
    run_tracker()

