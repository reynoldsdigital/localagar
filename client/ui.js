// HUD container. Just toggles visibility for now — score/rank updated in main.

export class HUD {
  constructor({ hudEl, leaderboardEl, minimapEl, deathEl }) {
    this.hudEl = hudEl;
    this.leaderboardEl = leaderboardEl;
    this.minimapEl = minimapEl;
    this.deathEl = deathEl;
  }
  show() {
    this.hudEl.hidden = false;
    this.leaderboardEl.hidden = false;
    this.minimapEl.hidden = false;
  }
  hide() {
    this.hudEl.hidden = true;
    this.leaderboardEl.hidden = true;
    this.minimapEl.hidden = true;
    this.deathEl.hidden = true;
  }
}
