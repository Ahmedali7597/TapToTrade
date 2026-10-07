// Replay / keep-still controls for preview.html (kept out of the HTML so the strict CSP allows it).
const stage = document.getElementById("stage");
const still = document.getElementById("still");
const replay = document.getElementById("replay");
function play() {
  const logo = stage.firstElementChild.cloneNode(true); // a fresh element restarts the CSS animation
  logo.classList.add("ttt-logo--replay"); // explicit choice: plays even with reduced motion
  stage.replaceChildren(logo);
}
replay.addEventListener("click", play);
stage.addEventListener("click", () => still.checked || play()); // clicking the logo replays it too
still.addEventListener("change", () => {
  stage.firstElementChild.classList.toggle("ttt-logo--still", still.checked);
  replay.disabled = still.checked;
});
