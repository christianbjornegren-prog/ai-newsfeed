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

function timeAgo(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return seconds + "s";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + "m";
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + "h";
  const days = Math.floor(hours / 24);
  if (days < 7) return days + "d";
  const weeks = Math.floor(days / 7);
  return weeks + "w";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function createCard(article) {
  const card = document.createElement("article");
  card.className = "card";

  const teaser = article.teaser || article.summary || "";
  const summary = article.summary || "";
  const ago = timeAgo(article.published_at || article.fetched_at);

  card.innerHTML =
    '<div class="card-header">' +
      '<span class="card-source">' + escapeHtml(article.source || "") + '</span>' +
      '<span class="card-time">' + escapeHtml(ago) + '</span>' +
    '</div>' +
    '<h2 class="card-title">' + escapeHtml(article.title || "") + '</h2>' +
    '<p class="card-teaser">' + escapeHtml(teaser) + '</p>' +
    '<div class="card-details">' +
      '<p class="card-summary">' + escapeHtml(summary) + '</p>' +
      '<a class="card-link" href="' + escapeAttr(article.url || "#") + '" target="_blank" rel="noopener noreferrer">Read more \u2192</a>' +
    '</div>';

  card.addEventListener("click", function (e) {
    if (e.target.closest(".card-link")) return;
    const wasExpanded = card.classList.contains("expanded");
    feedEl.querySelectorAll(".card.expanded").forEach(function (c) {
      c.classList.remove("expanded");
    });
    if (!wasExpanded) {
      card.classList.add("expanded");
    }
  });

  return card;
}

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

    snapshot.forEach(function (doc) {
      const card = createCard(doc.data());
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
