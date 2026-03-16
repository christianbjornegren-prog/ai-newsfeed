// AI Newsfeed — fetch articles from Firestore and render card feed

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

function formatDate(timestamp) {
  if (!timestamp) return "";
  const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
  return date.toLocaleDateString("sv-SE", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function createCard(article) {
  const card = document.createElement("article");
  card.className = "card";

  card.innerHTML =
    '<div class="card-source">' + escapeHtml(article.source || "") + "</div>" +
    '<h2 class="card-title">' + escapeHtml(article.title || "") + "</h2>" +
    '<p class="card-summary">' + escapeHtml(article.summary || "") + "</p>" +
    '<div class="card-footer">' +
      '<a class="card-link" href="' + escapeAttr(article.url || "#") + '" target="_blank" rel="noopener noreferrer">Läs mer \u2192</a>' +
      '<time class="card-date">' + escapeHtml(formatDate(article.published_at || article.fetched_at)) + "</time>" +
    "</div>";

  return card;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

    snapshot.forEach((doc, index) => {
      const card = createCard(doc.data());
      feedEl.appendChild(card);
    });

    // Staggered fade-in
    const cards = feedEl.querySelectorAll(".card");
    cards.forEach((card, i) => {
      setTimeout(() => card.classList.add("visible"), i * 80);
    });
  } catch (err) {
    console.error("Failed to load articles:", err);
    loaderEl.remove();
    feedEl.innerHTML =
      '<div class="error">Kunde inte ladda artiklar.<br>Kontrollera Firebase-konfigurationen.</div>';
  }
}

loadArticles();
