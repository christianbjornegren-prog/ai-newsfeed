// AI Newsfeed — fetch articles from Firestore and render feed

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const feedEl = document.getElementById("feed");
const loaderEl = document.getElementById("loader");
const modalOverlay = document.getElementById("modalOverlay");
const modalBody = document.getElementById("modalBody");
const modalClose = document.getElementById("modalClose");
const omOverlay = document.getElementById("omOverlay");
const omClose = document.getElementById("omClose");
const burgerBtn = document.getElementById("burgerBtn");
const burgerMenu = document.getElementById("burgerMenu");
const burgerAbout = document.getElementById("burgerAbout");
const reloadBtn = document.getElementById("reloadBtn");
const searchBtn = document.getElementById("searchBtn");
const searchRow = document.getElementById("searchRow");
const searchInput = document.getElementById("searchInput");
const chipsRow = document.getElementById("chipsRow");
const scrollTopBtn = document.getElementById("scrollTop");
const lastUpdatedEl = document.getElementById("last-updated");

const SV_MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun",
                    "jul", "aug", "sep", "okt", "nov", "dec"];

const CACHE_KEY = "feedCacheV1";
const READ_KEY = "readUrlsV1";
const VISIT_KEY = "lastVisitV1";
const MAX_READ_URLS = 800;

// --- App state ---

let allArticles = [];      // normalized base set (age-filtered)
let activeTopic = null;    // chip filter
let searchQuery = "";      // free-text filter
let visitStamped = false;

const prevVisitMs = (function () {
  try { return parseInt(localStorage.getItem(VISIT_KEY), 10) || null; }
  catch (e) { return null; }
})();

let readSet = (function () {
  try { return new Set(JSON.parse(localStorage.getItem(READ_KEY) || "[]")); }
  catch (e) { return new Set(); }
})();

function markRead(url) {
  if (!url || readSet.has(url)) return;
  readSet.add(url);
  try {
    let arr = Array.from(readSet);
    if (arr.length > MAX_READ_URLS) arr = arr.slice(arr.length - MAX_READ_URLS);
    localStorage.setItem(READ_KEY, JSON.stringify(arr));
  } catch (e) { /* storage full — read-state is a nice-to-have */ }
}

function stampVisit() {
  if (visitStamped) return;
  visitStamped = true;
  try { localStorage.setItem(VISIT_KEY, String(Date.now())); } catch (e) {}
}

// --- Formatting helpers ---

function formatDate(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const now = new Date();
  const diffMin = Math.floor((now.getTime() - date.getTime()) / 60000);

  if (diffMin < 1) return "nu";
  if (diffMin < 60) return diffMin + " min";

  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  const time = pad(date.getHours()) + ":" + pad(date.getMinutes());

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);

  if (date >= todayStart) return time;
  if (date >= yesterdayStart) return "I går " + time;
  return date.getDate() + " " + SV_MONTHS[date.getMonth()] + ", " + time;
}

function formatFullDate(ms) {
  if (!ms) return "";
  const date = new Date(ms);
  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  return date.getDate() + " " + SV_MONTHS[date.getMonth()] + " " + date.getFullYear() +
         ", " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isSafeUrl(url) {
  return typeof url === "string" && /^https?:\/\//i.test(url);
}

function truncateTitle(str) {
  if (!str) return "";
  return str.length > 100 ? str.slice(0, 97) + "..." : str;
}

function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === "number") return ts;
  if (ts.toMillis) return ts.toMillis();
  return new Date(ts).getTime() || 0;
}

// Normalize a Firestore doc (or cached object) to a plain, JSON-safe article
function normalizeArticle(raw) {
  return {
    title: raw.title || "",
    url: raw.url || "",
    source: raw.source || "",
    topic: raw.topic || "AI",
    teaser: raw.teaser || "",
    summary: raw.summary || "",
    rss_description: raw.rss_description || "",
    image_url: isSafeUrl(raw.image_url) ? raw.image_url : "",
    published_at: toMs(raw.published_at),
    fetched_at: toMs(raw.fetched_at),
  };
}

function isNewForVisitor(article) {
  return prevVisitMs !== null && article.fetched_at > prevVisitMs;
}

// --- Modals ---

function buildRelatedHtml(article) {
  const related = allArticles.filter(function (a) {
    return a.topic === article.topic && a.url !== article.url;
  }).slice(0, 3);
  if (related.length === 0) return "";

  let html = '<div class="modal-related"><div class="modal-related-label">Mer om ' +
             escapeHtml(article.topic) + "</div>";
  related.forEach(function (r, i) {
    html += '<div class="modal-related-item" data-rel-index="' + i + '">' +
              '<span class="modal-related-source">' + escapeHtml(r.source) + "</span>" +
              '<span class="modal-related-title">' + escapeHtml(truncateTitle(r.title)) + "</span>" +
            "</div>";
  });
  html += "</div>";
  return { html: html, related: related };
}

function openModal(article, cardEl) {
  markRead(article.url);
  if (cardEl) cardEl.classList.add("read");

  let html = "";
  if (article.image_url) {
    html += '<div><img class="modal-image" src="' + escapeAttr(article.image_url) +
            '" alt="" onerror="this.parentElement.remove()"></div>';
  }

  const bodyText = article.summary || article.rss_description || article.teaser || "";
  const rel = buildRelatedHtml(article);

  html += '<div class="modal-content">';
  html += '<div class="modal-source">' + escapeHtml(article.source) + "</div>";
  html += '<h2 class="modal-title">' + escapeHtml(article.title) + "</h2>";
  html += '<div class="modal-date">' + escapeHtml(formatFullDate(article.published_at || article.fetched_at)) + "</div>";
  html += '<p class="modal-summary">' + escapeHtml(bodyText) + "</p>";
  html += '<div class="modal-actions">';
  if (isSafeUrl(article.url)) {
    html += '<a class="modal-link" href="' + escapeAttr(article.url) +
            '" target="_blank" rel="noopener noreferrer">Läs hela artikeln →</a>';
  }
  html += '<button class="modal-share" id="modalShare">Dela</button>';
  html += "</div>";
  if (rel && rel.html) html += rel.html;
  html += "</div>";

  modalBody.innerHTML = html;
  modalOverlay.classList.add("active");
  document.body.style.overflow = "hidden";
  modalOverlay.scrollTop = 0;
  const modalEl = document.getElementById("modal");
  if (modalEl) modalEl.scrollTop = 0;

  const shareBtn = document.getElementById("modalShare");
  if (shareBtn) {
    shareBtn.addEventListener("click", function () {
      if (navigator.share) {
        navigator.share({ title: article.title, url: article.url }).catch(function () {});
      } else if (navigator.clipboard) {
        navigator.clipboard.writeText(article.url).then(function () {
          shareBtn.textContent = "Länk kopierad ✓";
          setTimeout(function () { shareBtn.textContent = "Dela"; }, 2000);
        }).catch(function () {});
      }
    });
  }

  if (rel && rel.related) {
    modalBody.querySelectorAll(".modal-related-item").forEach(function (el) {
      el.addEventListener("click", function () {
        openModal(rel.related[parseInt(el.getAttribute("data-rel-index"), 10)]);
      });
    });
  }
}

function closeModal() {
  modalOverlay.classList.remove("active");
  document.body.style.overflow = "";
}

function closeOmModal() {
  omOverlay.classList.remove("active");
  document.body.style.overflow = "";
}

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", function (e) {
  if (e.target === modalOverlay) closeModal();
});

omClose.addEventListener("click", closeOmModal);
omOverlay.addEventListener("click", function (e) {
  if (e.target === omOverlay) closeOmModal();
});

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") { closeModal(); closeOmModal(); }
});

// --- Header controls ---

burgerBtn.addEventListener("click", function (e) {
  e.stopPropagation();
  burgerMenu.classList.toggle("open");
});

document.addEventListener("click", function (e) {
  if (!burgerBtn.contains(e.target) && !burgerMenu.contains(e.target)) {
    burgerMenu.classList.remove("open");
  }
});

burgerAbout.addEventListener("click", function () {
  burgerMenu.classList.remove("open");
  omOverlay.classList.add("active");
  document.body.style.overflow = "hidden";
});

reloadBtn.addEventListener("click", function () {
  window.location.reload();
});

searchBtn.addEventListener("click", function () {
  const open = searchRow.classList.toggle("open");
  if (open) {
    searchInput.focus();
  } else {
    searchInput.value = "";
    if (searchQuery) { searchQuery = ""; renderFeed(); }
  }
});

let searchTimer = null;
searchInput.addEventListener("input", function () {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(function () {
    const q = searchInput.value.trim().toLowerCase();
    if (q !== searchQuery) { searchQuery = q; renderFeed(); }
  }, 150);
});

window.addEventListener("scroll", function () {
  scrollTopBtn.classList.toggle("show", window.scrollY > 600);
}, { passive: true });

scrollTopBtn.addEventListener("click", function () {
  window.scrollTo({ top: 0, behavior: "smooth" });
});

// --- Cards & clusters ---

function badgeHtml(article) {
  return isNewForVisitor(article) ? '<span class="new-badge">NY</span>' : "";
}

function cardHeaderHtml(article) {
  return '<div class="card-header">' +
           '<span class="card-source">' + badgeHtml(article) + escapeHtml(article.source) + "</span>" +
           '<span class="card-time">' + escapeHtml(formatDate(article.published_at || article.fetched_at)) + "</span>" +
         "</div>";
}

function thumbHtml(article) {
  if (!article.image_url) return "";
  return '<div class="card-thumb-wrap"><img class="card-thumb" src="' +
         escapeAttr(article.image_url) + '" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>';
}

function createCard(article) {
  const card = document.createElement("article");
  card.className = "card" + (readSet.has(article.url) ? " read" : "");

  const teaser = article.teaser || article.summary || "";

  card.innerHTML =
    cardHeaderHtml(article) +
    '<div class="card-body">' +
      '<div class="card-text">' +
        '<h2 class="card-title">' + escapeHtml(truncateTitle(article.title)) + "</h2>" +
        '<p class="card-teaser">' + escapeHtml(teaser) + "</p>" +
      "</div>" +
      thumbHtml(article) +
    "</div>";

  card.addEventListener("click", function () {
    openModal(article, card);
  });

  return card;
}

// Pick the best lead article for a cluster: among the three newest,
// prefer one with both image and summary, then one with an image, else newest.
function pickMainArticle(sorted) {
  const candidates = sorted.slice(0, 3);
  return candidates.find(function (a) { return a.image_url && a.summary; }) ||
         candidates.find(function (a) { return a.image_url; }) ||
         sorted[0];
}

function createCluster(topic, articles) {
  const cluster = document.createElement("div");
  cluster.className = "cluster";

  const header = document.createElement("div");
  header.className = "cluster-header";
  header.textContent = topic.toUpperCase();
  cluster.appendChild(header);

  const main = pickMainArticle(articles);
  const subs = articles.filter(function (a) { return a !== main; });

  const mainEl = document.createElement("div");
  mainEl.className = "cluster-main" + (readSet.has(main.url) ? " read" : "");

  let mainHtml = "";
  if (main.image_url) {
    mainHtml += '<div><img class="cluster-main-image" src="' + escapeAttr(main.image_url) +
                '" alt="" loading="lazy" onerror="this.parentElement.remove()"></div>';
  }
  mainHtml += '<div class="cluster-main-content">' +
                cardHeaderHtml(main) +
                '<h2 class="card-title">' + escapeHtml(truncateTitle(main.title)) + "</h2>" +
                '<p class="card-teaser">' + escapeHtml(main.teaser || main.summary || "") + "</p>" +
              "</div>";

  mainEl.innerHTML = mainHtml;
  mainEl.addEventListener("click", function () { openModal(main, mainEl); });
  cluster.appendChild(mainEl);

  subs.forEach(function (sub, idx) {
    const subEl = document.createElement("div");
    subEl.className = "cluster-sub" + (readSet.has(sub.url) ? " read" : "");
    if (idx >= 2) subEl.classList.add("cluster-hidden");

    subEl.innerHTML =
      '<div class="cluster-sub-text">' +
        cardHeaderHtml(sub) +
        '<h2 class="cluster-sub-title">' + escapeHtml(truncateTitle(sub.title)) + "</h2>" +
        '<p class="card-teaser">' + escapeHtml(sub.teaser || sub.summary || "") + "</p>" +
      "</div>" +
      thumbHtml(sub);

    subEl.addEventListener("click", function () { openModal(sub, subEl); });
    cluster.appendChild(subEl);
  });

  if (articles.length > 3) {
    const more = document.createElement("div");
    more.className = "cluster-more";
    more.innerHTML = "Mer om " + escapeHtml(topic) + " &rarr;";
    more.addEventListener("click", function () {
      const hidden = cluster.querySelectorAll(".cluster-sub.cluster-hidden");
      if (hidden.length > 0) {
        hidden.forEach(function (el) { el.classList.remove("cluster-hidden"); });
        more.innerHTML = "Visa mindre &uarr;";
      } else {
        const subEls = cluster.querySelectorAll(".cluster-sub");
        for (let j = 0; j < subEls.length; j++) {
          if (j >= 2) subEls[j].classList.add("cluster-hidden");
        }
        more.innerHTML = "Mer om " + escapeHtml(topic) + " &rarr;";
      }
    });
    cluster.appendChild(more);
  }

  return cluster;
}

function buildFeedItems(articles) {
  const groups = {};
  articles.forEach(function (article) {
    const topic = article.topic || "AI";
    if (!groups[topic]) groups[topic] = [];
    groups[topic].push(article);
  });

  Object.keys(groups).forEach(function (topic) {
    groups[topic].sort(function (a, b) {
      return (b.published_at || b.fetched_at) - (a.published_at || a.fetched_at);
    });
  });

  const items = [];
  Object.keys(groups).forEach(function (topic) {
    const group = groups[topic];
    const sortTime = group[0].published_at || group[0].fetched_at;
    if (group.length >= 2) {
      items.push({ type: "cluster", topic: topic, articles: group, sortTime: sortTime });
    } else {
      items.push({ type: "solo", article: group[0], sortTime: sortTime });
    }
  });

  items.sort(function (a, b) { return b.sortTime - a.sortTime; });
  return items;
}

// --- Topic chips ---

function buildChips() {
  const counts = {};
  allArticles.forEach(function (a) {
    counts[a.topic] = (counts[a.topic] || 0) + 1;
  });
  const topics = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; })
                       .slice(0, 12);

  chipsRow.innerHTML = "";
  if (allArticles.length === 0) return;

  const allChip = document.createElement("button");
  allChip.className = "chip" + (activeTopic === null ? " active" : "");
  allChip.textContent = "Alla";
  allChip.setAttribute("aria-pressed", activeTopic === null ? "true" : "false");
  allChip.addEventListener("click", function () {
    if (activeTopic !== null) { activeTopic = null; buildChips(); renderFeed(); }
  });
  chipsRow.appendChild(allChip);

  topics.forEach(function (topic) {
    const chip = document.createElement("button");
    chip.className = "chip" + (activeTopic === topic ? " active" : "");
    chip.setAttribute("aria-pressed", activeTopic === topic ? "true" : "false");
    chip.innerHTML = escapeHtml(topic) + '<span class="chip-count">' + counts[topic] + "</span>";
    chip.addEventListener("click", function () {
      activeTopic = (activeTopic === topic) ? null : topic;
      buildChips();
      renderFeed();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
    chipsRow.appendChild(chip);
  });
}

// --- Rendering ---

function applyFilters() {
  return allArticles.filter(function (a) {
    if (activeTopic && a.topic !== activeTopic) return false;
    if (searchQuery) {
      const haystack = (a.title + " " + a.teaser + " " + a.summary + " " +
                        a.source + " " + a.topic).toLowerCase();
      if (haystack.indexOf(searchQuery) === -1) return false;
    }
    return true;
  });
}

function renderFeed() {
  const articles = applyFilters();
  feedEl.innerHTML = "";

  if (articles.length === 0) {
    const isFiltered = activeTopic || searchQuery;
    feedEl.innerHTML = '<div class="empty">' +
      (isFiltered ? "Inget matchar din filtrering." : "Inga artiklar att visa just nu.") +
      "</div>";
    if (isFiltered) {
      const reset = document.createElement("button");
      reset.className = "reset-filters";
      reset.textContent = "Rensa filter";
      reset.addEventListener("click", function () {
        activeTopic = null;
        searchQuery = "";
        searchInput.value = "";
        buildChips();
        renderFeed();
      });
      feedEl.querySelector(".empty").appendChild(document.createElement("br"));
      feedEl.querySelector(".empty").appendChild(reset);
    }
    return;
  }

  const isFiltered = activeTopic || searchQuery;

  if (isFiltered) {
    // Flat list — clustering adds no value inside a single topic or search hit
    articles
      .slice()
      .sort(function (a, b) {
        return (b.published_at || b.fetched_at) - (a.published_at || a.fetched_at);
      })
      .forEach(function (a) { feedEl.appendChild(createCard(a)); });
  } else {
    buildFeedItems(articles).forEach(function (item) {
      if (item.type === "cluster") {
        feedEl.appendChild(createCluster(item.topic, item.articles));
      } else {
        feedEl.appendChild(createCard(item.article));
      }
    });
  }

  const elements = feedEl.querySelectorAll(".card, .cluster");
  elements.forEach(function (el, i) {
    setTimeout(function () { el.classList.add("visible"); }, Math.min(i, 10) * 60);
  });
}

function updatePulseLine(fromCache) {
  let latestFetchedAt = 0;
  let publishedToday = 0;
  let newForYou = 0;

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

  allArticles.forEach(function (a) {
    if (a.fetched_at > latestFetchedAt) latestFetchedAt = a.fetched_at;
    if ((a.published_at || a.fetched_at) >= todayStart) publishedToday++;
    if (isNewForVisitor(a)) newForYou++;
  });

  if (!lastUpdatedEl) return;
  if (!latestFetchedAt) { lastUpdatedEl.textContent = ""; return; }

  const d = new Date(latestFetchedAt);
  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  const time = pad(d.getHours()) + ":" + pad(d.getMinutes());
  const yesterdayStart = todayStart - 86400000;
  let label;
  if (d.getTime() >= todayStart) label = "I dag " + time;
  else if (d.getTime() >= yesterdayStart) label = "I går " + time;
  else label = d.getDate() + " " + SV_MONTHS[d.getMonth()] + ", " + time;

  let text = "Senast uppdaterad: " + label;
  if (publishedToday > 0) text += " · " + publishedToday + " i dag";
  if (newForYou > 0) text += " · " + newForYou + " nya för dig";
  if (fromCache) text += " · uppdaterar…";
  lastUpdatedEl.textContent = text;
}

// --- Data loading ---

function selectBaseSet(pool) {
  const now = Date.now();
  const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
  const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

  function byAge(maxMs) {
    return pool.filter(function (a) {
      const ms = a.published_at || a.fetched_at;
      return !ms || (now - ms <= maxMs);
    });
  }

  let base = byAge(THREE_DAYS);
  if (base.length < 10) base = byAge(SEVEN_DAYS);
  if (base.length === 0) base = pool;
  return base;
}

function presentArticles(pool, fromCache) {
  allArticles = selectBaseSet(pool);
  if (loaderEl.parentElement) loaderEl.remove();
  buildChips();
  renderFeed();
  updatePulseLine(fromCache);
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.articles) || parsed.articles.length === 0) return null;
    return parsed.articles.map(normalizeArticle);
  } catch (e) {
    return null;
  }
}

function writeCache(articles) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), articles: articles }));
  } catch (e) { /* storage full — cache is a nice-to-have */ }
}

async function loadArticles() {
  // 1. Instant render from cache while the network round-trip is in flight
  const cached = readCache();
  if (cached) presentArticles(cached, true);

  // 2. Live data
  try {
    const q = query(
      collection(db, "articles"),
      where("summary", "!=", null),
      orderBy("fetched_at", "desc"),
      limit(100)
    );

    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      if (!cached) {
        if (loaderEl.parentElement) loaderEl.remove();
        feedEl.innerHTML = '<div class="empty">Inga artiklar att visa just nu.</div>';
      }
      return;
    }

    const live = [];
    snapshot.forEach(function (doc) { live.push(normalizeArticle(doc.data())); });

    presentArticles(live, false);
    writeCache(live);
    stampVisit();
  } catch (err) {
    console.error("Failed to load articles:", err);
    if (cached) {
      // Keep showing the cached feed; just note that refresh failed
      if (lastUpdatedEl) lastUpdatedEl.textContent += " · kunde inte uppdatera";
      return;
    }
    if (loaderEl.parentElement) loaderEl.remove();
    feedEl.innerHTML =
      '<div class="error">Kunde inte ladda artiklar.<br>' +
      '<button class="reset-filters" id="retryBtn">Försök igen</button></div>';
    const retry = document.getElementById("retryBtn");
    if (retry) retry.addEventListener("click", function () { window.location.reload(); });
  }
}

loadArticles();

// --- PWA: register service worker ---

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("sw.js").catch(function (err) {
      console.warn("Service worker registration failed:", err);
    });
  });
}
