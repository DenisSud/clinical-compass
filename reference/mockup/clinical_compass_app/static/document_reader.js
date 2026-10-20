"use strict";
const zoomButton = document.getElementById("reader-zoom");
const canvas = document.getElementById("document-canvas");
if (zoomButton && canvas) {
  zoomButton.hidden = false;
  zoomButton.addEventListener("click", () => {
    const zoomed = canvas.classList.toggle("is-zoomed");
    zoomButton.setAttribute("aria-pressed", String(zoomed));
    zoomButton.textContent = zoomed ? "По ширине" : "Увеличить";
    if (!zoomed) canvas.scrollLeft = 0;
  });
}
