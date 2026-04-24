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

const SV_MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun",
                    "jul", "aug", "sep", "okt", "nov", "dec"];

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 60) {
    return diffMin + " min";
  }

  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  const time = pad(date.getHours()) + ":" + pad(date.getMinutes());

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 86400000);

  if (date >= todayStart) {
    return time;
  }
  if (date >= yesterdayStart) {
    return "I g\u00e5r " + time;
  }
  return date.getDate() + " " + SV_MONTHS[date.getMonth()] + ", " + time;
}

function formatFullDate(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  var day = date.getDate();
  var month = SV_MONTHS[date.getMonth()];
  var year = date.getFullYear();
  var time = pad(date.getHours()) + ":" + pad(date.getMinutes());
  return day + " " + month + " " + year + ", " + time;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function openModal(article) {
  var html = "";

  if (article.image_url) {
    html += '<div><img class="modal-image" src="' + escapeAttr(article.image_url) + '" alt="" onerror="this.parentElement.remove()"></div>';
  }

  html += '<div class="modal-content">';
  html += '<div class="modal-source">' + escapeHtml(article.source || "") + '</div>';
  html += '<h2 class="modal-title">' + escapeHtml(article.title || "") + '</h2>';
  html += '<div class="modal-date">' + escapeHtml(formatFullDate(article.published_at || article.fetched_at)) + '</div>';
  html += '<p class="modal-summary">' + escapeHtml(article.summary || "") + '</p>';
  html += '<a class="modal-link" href="' + escapeAttr(article.url || "#") + '" target="_blank" rel="noopener noreferrer">Read more \u2192</a>';
  html += '</div>';

  modalBody.innerHTML = html;
  modalOverlay.classList.add("active");
  document.body.style.overflow = "hidden";
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

function createCard(article) {
  const card = document.createElement("article");
  card.className = "card";

  const teaser = article.teaser || article.summary || "";
  const ago = formatDate(article.published_at || article.fetched_at);

  var bodyHtml =
    '<div class="card-text">' +
      '<h2 class="card-title">' + escapeHtml(article.title || "") + '</h2>' +
      '<p class="card-teaser">' + escapeHtml(teaser) + '</p>' +
    '</div>';

  if (article.image_url) {
    bodyHtml += '<div class="card-thumb-wrap"><img class="card-thumb" src="' + escapeAttr(article.image_url) + '" alt="" onerror="this.parentElement.remove()"></div>';
  }

  card.innerHTML =
    '<div class="card-header">' +
      '<span class="card-source">' + escapeHtml(article.source || "") + '</span>' +
      '<span class="card-time">' + escapeHtml(ago) + '</span>' +
    '</div>' +
    '<div class="card-body">' + bodyHtml + '</div>';

  card.addEventListener("click", function () {
    openModal(article);
  });

  return card;
}

// --- Clustering helpers ---

function getTimestamp(article) {
  var ts = article.published_at || article.fetched_at;
  if (!ts) return 0;
  if (ts.toMillis) return ts.toMillis();
  return new Date(ts).getTime();
}

function createCluster(topic, articles) {
  var cluster = document.createElement("div");
  cluster.className = "cluster";

  // Header bar
  var header = document.createElement("div");
  header.className = "cluster-header";
  header.textContent = topic.toUpperCase();
  cluster.appendChild(header);

  // Main article (newest)
  var main = articles[0];
  var mainEl = document.createElement("div");
  mainEl.className = "cluster-main";

  var mainHtml = "";
  if (main.image_url) {
    mainHtml += '<div><img class="cluster-main-image" src="' + escapeAttr(main.image_url) + '" alt="" onerror="this.parentElement.remove()"></div>';
  }
  mainHtml += '<div class="cluster-main-content">';
  mainHtml += '<div class="card-header">';
  mainHtml += '<span class="card-source">' + escapeHtml(main.source || "") + '</span>';
  mainHtml += '<span class="card-time">' + escapeHtml(formatDate(main.published_at || main.fetched_at)) + '</span>';
  mainHtml += '</div>';
  mainHtml += '<h2 class="card-title">' + escapeHtml(main.title || "") + '</h2>';
  mainHtml += '<p class="card-teaser">' + escapeHtml(main.teaser || main.summary || "") + '</p>';
  mainHtml += '</div>';

  mainEl.innerHTML = mainHtml;
  mainEl.addEventListener("click", function () { openModal(main); });
  cluster.appendChild(mainEl);

  // Sub articles
  articles.slice(1).forEach(function (sub, idx) {
    var subEl = document.createElement("div");
    subEl.className = "cluster-sub";
    if (idx >= 2) subEl.classList.add("cluster-hidden");

    var subHtml = '<div class="cluster-sub-text">';
    subHtml += '<div class="card-header">';
    subHtml += '<span class="card-source">' + escapeHtml(sub.source || "") + '</span>';
    subHtml += '<span class="card-time">' + escapeHtml(formatDate(sub.published_at || sub.fetched_at)) + '</span>';
    subHtml += '</div>';
    subHtml += '<h2 class="cluster-sub-title">' + escapeHtml(sub.title || "") + '</h2>';
    subHtml += '<p class="card-teaser">' + escapeHtml(sub.teaser || sub.summary || "") + '</p>';
    subHtml += '</div>';
    if (sub.image_url) {
      subHtml += '<div class="card-thumb-wrap"><img class="card-thumb" src="' + escapeAttr(sub.image_url) + '" alt="" onerror="this.parentElement.remove()"></div>';
    }

    subEl.innerHTML = subHtml;
    subEl.addEventListener("click", function () { openModal(sub); });
    cluster.appendChild(subEl);
  });

  // "Mer om" toggle if more than 3 articles total
  if (articles.length > 3) {
    var more = document.createElement("div");
    more.className = "cluster-more";
    more.innerHTML = 'Mer om ' + escapeHtml(topic) + ' &rarr;';
    more.addEventListener("click", function () {
      var hidden = cluster.querySelectorAll(".cluster-sub.cluster-hidden");
      if (hidden.length > 0) {
        hidden.forEach(function (el) { el.classList.remove("cluster-hidden"); });
        more.innerHTML = 'Visa mindre &uarr;';
      } else {
        var subs = cluster.querySelectorAll(".cluster-sub");
        for (var j = 0; j < subs.length; j++) {
          if (j >= 2) subs[j].classList.add("cluster-hidden");
        }
        more.innerHTML = 'Mer om ' + escapeHtml(topic) + ' &rarr;';
      }
    });
    cluster.appendChild(more);
  }

  return cluster;
}

function buildFeedItems(articles) {
  // Group by topic
  var groups = {};
  articles.forEach(function (article) {
    var topic = article.topic || "AI";
    if (!groups[topic]) groups[topic] = [];
    groups[topic].push(article);
  });

  // Sort each group internally by published_at desc
  Object.keys(groups).forEach(function (topic) {
    groups[topic].sort(function (a, b) {
      return getTimestamp(b) - getTimestamp(a);
    });
  });

  // Build timeline: clusters (2+) and solo articles
  var items = [];
  Object.keys(groups).forEach(function (topic) {
    var group = groups[topic];
    if (group.length >= 2) {
      items.push({
        type: "cluster",
        topic: topic,
        articles: group,
        sortTime: getTimestamp(group[0])
      });
    } else {
      items.push({
        type: "solo",
        article: group[0],
        sortTime: getTimestamp(group[0])
      });
    }
  });

  // Sort by newest first
  items.sort(function (a, b) {
    return b.sortTime - a.sortTime;
  });

  return items;
}

// --- Load articles ---

async function loadArticles() {
  try {
    const q = query(
      collection(db, "articles"),
      where("summary", "!=", null),
      orderBy("fetched_at", "desc"),
      limit(100)
    );

    const snapshot = await getDocs(q);

    loaderEl.remove();

    if (snapshot.empty) {
      feedEl.innerHTML = '<div class="empty">Inga artiklar att visa just nu.</div>';
      return;
    }

    const now = Date.now();
    const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;
    const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000;

    const allArticles = [];
    snapshot.forEach(function (doc) { allArticles.push(doc.data()); });

    function filterByAge(pool, maxMs) {
      return pool.filter(function (a) {
        var ts = a.published_at || a.fetched_at;
        if (!ts) return true;
        var ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
        return now - ms <= maxMs;
      });
    }

    var articles = filterByAge(allArticles, THREE_DAYS);
    if (articles.length < 10) {
      articles = filterByAge(allArticles, SEVEN_DAYS);
    }

    if (articles.length === 0) {
      feedEl.innerHTML = '<div class="empty">Inga artiklar att visa just nu.</div>';
      return;
    }

    var items = buildFeedItems(articles);

    items.forEach(function (item) {
      if (item.type === "cluster") {
        feedEl.appendChild(createCluster(item.topic, item.articles));
      } else {
        feedEl.appendChild(createCard(item.article));
      }
    });

    // Staggered fade-in for both cards and clusters
    var elements = feedEl.querySelectorAll(".card, .cluster");
    elements.forEach(function (el, i) {
      setTimeout(function () { el.classList.add("visible"); }, i * 80);
    });

    // Show "Senast uppdaterad" based on the newest fetched_at among all articles
    var latestFetchedAt = null;
    articles.forEach(function (a) {
      var ts = a.fetched_at;
      if (!ts) return;
      var ms = ts.toMillis ? ts.toMillis() : new Date(ts).getTime();
      if (latestFetchedAt === null || ms > latestFetchedAt) latestFetchedAt = ms;
    });
    if (latestFetchedAt !== null) {
      var pad = function (n) { return n < 10 ? "0" + n : "" + n; };
      var d = new Date(latestFetchedAt);
      var now = new Date();
      var todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      var yesterdayStart = new Date(todayStart.getTime() - 86400000);
      var time = pad(d.getHours()) + ":" + pad(d.getMinutes());
      var label;
      if (d >= todayStart) {
        label = "I dag " + time;
      } else if (d >= yesterdayStart) {
        label = "I g\u00e5r " + time;
      } else {
        label = d.getDate() + " " + SV_MONTHS[d.getMonth()] + ", " + time;
      }
      var lastUpdatedEl = document.getElementById("last-updated");
      if (lastUpdatedEl) lastUpdatedEl.textContent = "Senast uppdaterad: " + label;
    }
  } catch (err) {
    console.error("Failed to load articles:", err);
    loaderEl.remove();
    feedEl.innerHTML =
      '<div class="error">Kunde inte ladda artiklar.<br>Kontrollera Firebase-konfigurationen.</div>';
  }
}

loadArticles();
