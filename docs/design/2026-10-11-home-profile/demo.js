// Fixture-only interactions. No network, storage, polling or production code.
const feed = document.querySelector(".feed");
const topView = new URLSearchParams(location.search).get("view") === "top";
if (topView && document.querySelector(".new-posts")) {
  const posts = [...feed.querySelectorAll(".post")];
  posts.sort((a, b) => Number(b.dataset.reactions) - Number(a.dataset.reactions));
  feed.append(...posts);
  document.querySelector(".feed-heading h1").textContent = "🔥 / 24h";
  document.querySelector(".feed-heading h1").setAttribute("aria-label", "Top 24 hours");
  document.querySelector(".new-posts").hidden = true;
  document.querySelector('[aria-current="page"]')?.removeAttribute("aria-current");
  document.querySelector('[aria-label="Top 24 hours"]').setAttribute("aria-current", "page");
}
document.querySelector(".new-posts")?.addEventListener("click", (event) => {
  const template = document.querySelector("#incoming");
  feed.prepend(template.content.cloneNode(true));
  event.currentTarget.hidden = true;
  document.querySelector("#feed-status").textContent = "1 new post added.";
});
const about = document.querySelector("dialog");
document
  .querySelector('[aria-label="About wordless.one"]')
  .addEventListener("click", () => about.showModal());
document.querySelector("dialog button").addEventListener("click", () => about.close());
