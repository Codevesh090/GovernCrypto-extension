# Implementation Plan: DAO Proposals Display

## Overview

Implement Feature 2 by creating two new source modules (`src/snapshot.ts`, `src/proposals.ts`), extending the popup HTML/CSS with two new screens, and wiring navigation + rendering logic into `src/popup.ts`. All changes are additive — Feature 1 files are only extended, never modified.

## Tasks

- [x] 1. Create `src/snapshot.ts` — API layer
  - Define `RawProposal` interface with fields: `id`, `title`, `body`, `choices`, `start`, `end`, `state`, `scores`, `scores_total`, `space { id, name }`
  - Implement `fetchProposals(space: string): Promise<RawProposal[]>` that POSTs to `https://hub.snapshot.org/graphql` with `Content-Type: application/json`
  - GraphQL query requests 20 proposals ordered by `created` descending for the given space
  - Throw `"HTTP error: {status}"` when response status is not 200
  - Throw first GraphQL error message when response body contains an `errors` field
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 9.1_

- [x] 2. Create `src/proposals.ts` — data transformation layer
  - Define `DisplayProposal` interface with fields: `id`, `title`, `bodyPreview`, `bodyDetail`, `choices`, `percentages`, `scores_total`, `state`, `timeLabel`, `spaceName`
  - Implement `stripMarkdown(text: string): string` — removes `##` headings, `**bold**`, backtick code, `> blockquotes`, and `[text](url)` links
  - Implement `formatTime(unixTimestamp: number, state: string): string` — returns `"Ends in Xd Xh"` / `"Ending soon"` / `"Ended Xd ago"` / `"Starts in Xd Xh"` based on state and remaining time
  - Implement `calcPercentages(scores: number[], scores_total: number): number[]` — returns `[]` when `scores_total` is 0 or falsy; otherwise `scores.map(s => Math.round((s / scores_total) * 1000) / 10)`
  - Implement `transformProposal(raw: RawProposal | null | undefined): DisplayProposal | null` — returns `null` for null/undefined input; maps all fields with `title.slice(0,80)`, `bodyPreview` = `stripMarkdown(body).slice(0,200)`, `bodyDetail` = `stripMarkdown(body).slice(0,1000)`
  - Implement `formatNumber(n: number): string` — returns `n.toLocaleString()`
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 9.2_

- [x] 3. Add HTML screens to `popup/popup.html` (additive only)
  - Add `class="screen"` to all four existing state divs (`#disconnected-state`, `#connecting-state`, `#connected-state`, `#error-state`)
  - Add `<button id="btn-proposals" class="proposals-button">View Proposals</button>` inside `#connected-state`
  - Add Screen 3 `<div id="screen-proposals" class="screen" style="display:none">` with: screen-header containing `#btn-back-proposals` and title "Proposals", `#proposals-loading`, `#proposals-empty`, `#proposals-error` (with `#proposals-error-msg` and `#btn-retry`), and `#proposals-list`
  - Add Screen 4 `<div id="screen-detail" class="screen" style="display:none">` with: screen-header containing `#btn-back-detail` and title "Detail", and `#detail-content`
  - _Requirements: 4.1, 5.1, 5.2, 6.1, 6.2_

- [x] 4. Add CSS for new screens to `popup/popup.css` (additive only)
  - CSS custom properties: `--bg-main: #0d0d1a`, `--bg-card: #1e1e3a`, `--bg-header: #12122a`, `--text-primary: #e2e8f0`, `--text-secondary: #94a3b8`
  - Screen layout: `#screen-proposals` and `#screen-detail` use `height: 100%`, `display: flex`, `flex-direction: column`, `background: var(--bg-main)`, `color: var(--text-primary)`
  - Screen header styles: `.screen-header` with back button (`.back-btn`) and title (`.screen-title`)
  - Proposals list: `#proposals-list` with `flex: 1`, `overflow-y: auto`, `padding: 8px`
  - Proposal card: `.proposal-card` with `background: var(--bg-card)`, `border-radius: 8px`, `padding: 12px`, `margin-bottom: 8px`, `cursor: pointer`, hover effect
  - Status badges: `.badge` base + `.badge-active` (green border `#00ff88`), `.badge-pending` (amber border `#f59e0b`), `.badge-closed` (grey border `#6b7280`)
  - Progress bar: `.progress-bar` track (`height: 4px`, `background: #2d2d4a`, `border-radius: 2px`) + `.progress-fill` + `.fill-green` (`#00ff88`), `.fill-red` (`#ef4444`), `.fill-grey` (`#4b5563`)
  - Choice labels: `.color-green`, `.color-red`, `.color-grey` text colors
  - Vote buttons: disabled state with `opacity: 0.4`, `cursor: not-allowed`, `pointer-events: none`
  - Detail content: `#detail-content` with `flex: 1`, `overflow-y: auto`, `padding: 12px`
  - _Requirements: 5.12, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

- [x] 5. Add navigation state and core wiring to `src/popup.ts` (additive only)
  - Add imports: `import { fetchProposals } from './snapshot.js'` and `import { transformProposal, formatNumber, DisplayProposal } from './proposals.js'`
  - Add `type AppScreen = 'connect' | 'connected' | 'proposals' | 'detail'`
  - Add `appState` object: `{ screen: 'connect' as AppScreen, proposals: [] as DisplayProposal[], selectedProposal: null as DisplayProposal | null, address: '' }`
  - Add `let isLoadingProposals = false`
  - Implement `hideAllScreens()`: `document.querySelectorAll('.screen').forEach(el => (el as HTMLElement).style.display = 'none')`
  - Implement `renderCurrentScreen()`: calls `hideAllScreens()` then switches on `appState.screen` to show the correct screen; `'detail'` case also calls `renderProposalDetail(appState.selectedProposal!)`
  - Implement `navigate(screen: AppScreen, data?: { proposal?: DisplayProposal })`: updates `appState.screen`, sets `appState.selectedProposal` if `data?.proposal` provided, calls `renderCurrentScreen()`
  - In `initialize()`: wire `btn-proposals` click → fetch proposals (guard with `isLoadingProposals`), set loading state, call `fetchProposals('uniswapgovernance.eth')`, transform results, store in `appState.proposals`, navigate to `'proposals'`; wire `btn-back-proposals` → `navigate('connected')`; wire `btn-back-detail` → `navigate('proposals')`; wire `btn-retry` → re-trigger proposals fetch
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 4.2, 4.3, 4.4, 5.3, 5.4, 5.5, 5.6, 5.13, 6.8_

- [x] 6. Add proposal list rendering to `src/popup.ts`
  - Implement `showProposalsLoading()`: shows `#proposals-loading`, hides `#proposals-list`, `#proposals-empty`, `#proposals-error`
  - Implement `showProposalsEmpty()`: shows `#proposals-empty`, hides others
  - Implement `showProposalsError(msg: string)`: shows `#proposals-error`, sets `#proposals-error-msg` textContent to `msg`, hides others
  - Implement `renderProposalCards(proposals: DisplayProposal[])`: clears `#proposals-list` with `list.innerHTML = ''`, builds a `DocumentFragment`, iterates proposals creating `.proposal-card` divs
  - Each card: status badge (`span.badge.badge-${p.state}` with `textContent = p.state`), space name (`p.card-space`), title (`p.card-title`), time label (`p.card-time`) — all via `textContent`
  - When `p.scores_total > 0`: compute top-2 pairs via `pairs.sort((a,b) => b.percent - a.percent).slice(0,2)`, render each as `.choice-row` with `span.choice-label.color-{color}` and `.progress-bar > .progress-fill.fill-{color}` with `fill.style.width = \`${percent}%\``
  - Assign `card.onclick = () => navigate('detail', { proposal: p })`
  - Append fragment to list; call `showProposalsEmpty()` if proposals array is empty
  - _Requirements: 5.7, 5.8, 5.9, 5.10, 5.11, 7.1, 7.2_

- [x] 7. Add proposal detail rendering to `src/popup.ts`
  - Implement `renderProposalDetail(proposal: DisplayProposal)`: clears `#detail-content` with `container.innerHTML = ''`
  - Header section: space name, badge (`span.badge.badge-${proposal.state}`), full title, time label — all via `textContent`
  - Body section: plain text from `proposal.bodyDetail` (max 1000 chars) via `textContent`
  - Votes section: for each choice, render label with percentage, `.progress-bar > .progress-fill` with `fill.style.width = \`${proposal.percentages[i]}%\``, colors: index 0 → `fill-green`, index 1 → `fill-red`, rest → `fill-grey`; same color classes for text labels
  - Total votes: `formatNumber(proposal.scores_total)` via `textContent`, monospace font class
  - Vote buttons: one per choice, `disabled` attribute set, `textContent = choice`, styled with `opacity: 0.4 / cursor: not-allowed`
  - Note element: `textContent = 'Voting coming in next update'`
  - All text assigned via `textContent` — never `innerHTML` for proposal content
  - _Requirements: 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 8.5, 8.6, 8.7, 8.8, 8.10_

- [x] 8. Build and verify
  - Run `npm run build` and confirm `dist/popup.js` is generated without TypeScript or esbuild errors
  - Reload the unpacked extension in Chrome (`chrome://extensions` → reload)
  - Manual smoke test: connect wallet → click "View Proposals" → proposals list renders → click a card → detail screen renders → back to list (no re-fetch) → back to connected screen
  - _Requirements: 9.1, 9.2, 9.3, 9.4_
