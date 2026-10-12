// Fixture-only interactions. No network, storage, polling or production code.
const feed = document.querySelector(".feed");
const pill = document.querySelector(".new-posts");

// ?view=top on a home page re-sorts the fixtures by reaction total, as /top would.
if (pill && new URLSearchParams(location.search).get("view") === "top") {
  const posts = [...feed.querySelectorAll(".post")];
  posts.sort((a, b) => Number(b.dataset.reactions) - Number(a.dataset.reactions));
  feed.append(...posts);
  feed.style.setProperty("--max", posts[0]?.dataset.reactions || 1);
  document.body.classList.add("is-top");
  pill.hidden = true;
  const heading = document.querySelector("[data-heading]");
  heading.textContent = "🔥 / 24h";
  heading.setAttribute("aria-label", "Top 24 hours");
  document.title = document.title.replace("Home", "Top 24h");
  document.querySelector('[data-nav="latest"]').removeAttribute("aria-current");
  document.querySelector('[data-nav="top"]').setAttribute("aria-current", "page");
}

pill?.addEventListener("click", () => {
  feed.prepend(document.querySelector("#incoming").content.cloneNode(true));
  pill.hidden = true;
  document.querySelector("#feed-status").textContent = "1 new post added.";
});

const about = document.querySelector("dialog");
document.querySelector('[data-nav="about"]').addEventListener("click", () => about.showModal());
about.querySelector("button").addEventListener("click", () => about.close());
