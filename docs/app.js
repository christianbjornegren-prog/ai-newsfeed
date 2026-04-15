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
    html += '<img class="modal-image" src="' + escapeAttr(article.image_url) + '" alt="">';
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

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", function (e) {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeModal();
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
    bodyHtml += '<img class="card-thumb" src="' + escapeAttr(article.image_url) + '" alt="">';
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

// --- Load articles ---

async function loadArticles() {
  try {
    const q = query(
      collection(db, "articles"),
      where("summary", "!=", null),
      orderBy("fetched_at", "desc"),
      limit(20)
    );

    const snapshot = await getDocs(q);

    loaderEl.remove();

    if (snapshot.empty) {
      feedEl.innerHTML = '<div class="empty">Inga artiklar att visa just nu.</div>';
      return;
    }

    const articles = [];
    snapshot.forEach(function (doc) {
      articles.push(doc.data());
    });
    articles.sort(function (a, b) {
      const timeA = a.published_at ? (a.published_at.toMillis ? a.published_at.toMillis() : new Date(a.published_at).getTime()) : 0;
      const timeB = b.published_at ? (b.published_at.toMillis ? b.published_at.toMillis() : new Date(b.published_at).getTime()) : 0;
      return timeB - timeA;
    });

    articles.forEach(function (article) {
      const card = createCard(article);
      feedEl.appendChild(card);
    });

    // Staggered fade-in
    const cards = feedEl.querySelectorAll(".card");
    cards.forEach(function (card, i) {
      setTimeout(function () { card.classList.add("visible"); }, i * 80);
    });
  } catch (err) {
    console.error("Failed to load articles:", err);
    loaderEl.remove();
    feedEl.innerHTML =
      '<div class="error">Kunde inte ladda artiklar.<br>Kontrollera Firebase-konfigurationen.</div>';
  }
}

loadArticles();
