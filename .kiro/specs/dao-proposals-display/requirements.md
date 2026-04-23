# Requirements Document

## Introduction

Feature 2 of the Snapshot Governance Voting Extension adds the ability for a connected user to fetch and browse DAO governance proposals from the Snapshot GraphQL API. When the user clicks "View Proposals" from the connected wallet screen, the extension fetches the 20 most recent proposals for the default space ("uniswapgovernance.eth"), displays them in a scrollable list (Screen 3), and allows the user to tap any proposal to view its full detail (Screen 4). No voting action is taken in this feature; vote buttons are rendered but disabled. All new code is additive and does not modify any Feature 1 files beyond the permitted HTML/CSS extensions.

## Glossary

- **Extension**: The Chrome MV3 Snapshot Governance Voting Extension.
- **Popup**: The 350px-wide Chrome extension popup rendered from `popup/popup.html`.
- **AppState**: The in-memory navigation state object `{ screen, proposals, selectedProposal, address }` maintained in `src/popup.ts`.
- **Screen**: A top-level `<div class="screen">` element in the popup HTML. Only one screen is visible at a time.
- **SnapshotAPI**: The Snapshot GraphQL endpoint at `https://hub.snapshot.org/graphql`.
- **Proposal**: A governance proposal object returned by the SnapshotAPI and transformed into a display-ready format.
- **RawProposal**: The unprocessed proposal object as returned directly by the SnapshotAPI.
- **DisplayProposal**: The transformed, display-ready proposal object produced by `transformProposal()` in `src/proposals.ts`.
- **ProposalCard**: A DOM element rendered in Screen 3 representing a single proposal summary.
- **ProposalDetail**: The full-detail view of a single proposal rendered in Screen 4.
- **DocumentFragment**: A lightweight DOM container used for batching DOM insertions.
- **Space**: A Snapshot governance space identified by an ENS name (e.g., `uniswapgovernance.eth`).
- **stripMarkdown**: A pure function in `src/proposals.ts` that removes Markdown syntax from text.
- **formatTime**: A pure function in `src/proposals.ts` that converts a Unix timestamp and proposal state into a human-readable time label.
- **calcPercentages**: A pure function in `src/proposals.ts` that computes vote percentages from scores and scores_total.
- **transformProposal**: A pure function in `src/proposals.ts` that converts a RawProposal into a DisplayProposal.
- **formatNumber**: A utility function that formats a number with locale-aware thousands separators.
- **isLoadingProposals**: A boolean flag in `src/popup.ts` that prevents concurrent proposal fetch requests.

---

## Requirements

### Requirement 1: Navigation State Machine

**User Story:** As a connected user, I want the popup to navigate between screens without page reloads, so that the experience feels fast and app-like.

#### Acceptance Criteria

1. THE Extension SHALL maintain an `appState` object with the shape `{ screen: "connect" | "connected" | "proposals" | "detail", proposals: DisplayProposal[], selectedProposal: DisplayProposal | null, address: string }`.
2. THE Extension SHALL expose a `navigate(screen, data?)` function that updates `appState` and calls `renderCurrentScreen()`.
3. THE Extension SHALL expose a `hideAllScreens()` function that sets `display: none` on every element matching `.screen`.
4. THE Extension SHALL expose a `renderCurrentScreen()` function that calls `hideAllScreens()` and then shows the screen corresponding to `appState.screen`.
5. WHEN `appState.screen` is `"connect"`, THE Extension SHALL call `showConnectScreen()`.
6. WHEN `appState.screen` is `"connected"`, THE Extension SHALL call `showConnectedScreen(appState.address)`.
7. WHEN `appState.screen` is `"proposals"`, THE Extension SHALL show the element with id `screen-proposals`.
8. WHEN `appState.screen` is `"detail"`, THE Extension SHALL show the element with id `screen-detail` and call `renderProposalDetail(appState.selectedProposal)`.

---

### Requirement 2: Fetch Proposals from Snapshot API

**User Story:** As a connected user, I want the extension to retrieve the latest governance proposals, so that I can see what is currently up for vote.

#### Acceptance Criteria

1. THE SnapshotAPI module (`src/snapshot.ts`) SHALL export a `fetchProposals(space: string)` function that sends a POST request to `https://hub.snapshot.org/graphql`.
2. WHEN `fetchProposals` is called, THE SnapshotAPI module SHALL request the 20 most recent proposals ordered by `created` descending for the given space.
3. THE SnapshotAPI module SHALL request the following fields for each proposal: `id`, `title`, `body`, `choices`, `start`, `end`, `state`, `scores`, `scores_total`, `space { id, name }`.
4. WHEN the HTTP response status is not 200, THE SnapshotAPI module SHALL throw an error with a descriptive message including the HTTP status code.
5. WHEN the GraphQL response contains an `errors` field, THE SnapshotAPI module SHALL throw an error with the first error message from the response.
6. WHEN `fetchProposals` is called, THE SnapshotAPI module SHALL set the `Content-Type` request header to `application/json`.

---

### Requirement 3: Data Transformation

**User Story:** As a developer, I want raw API data transformed into display-ready objects, so that the UI layer contains no data-processing logic.

#### Acceptance Criteria

1. THE `src/proposals.ts` module SHALL export a `stripMarkdown(text: string): string` function that removes `##`, `**`, backticks, `>` blockquotes, and Markdown hyperlinks, returning plain text.
2. THE `src/proposals.ts` module SHALL export a `formatTime(unixTimestamp: number, state: string): string` function that returns a human-readable label according to the following rules:
   - `active` + more than 1 day remaining → `"Ends in Xd Xh"`
   - `active` + more than 1 hour remaining → `"Ends in Xh"`
   - `active` + less than 1 hour remaining → `"Ending soon"`
   - `pending` + more than 1 day remaining → `"Starts in Xd Xh"`
   - `pending` + more than 1 hour remaining → `"Starts in Xh"`
   - `pending` + less than 1 hour remaining → `"Starting soon"`
   - `closed` + more than 1 day ago → `"Ended Xd ago"`
   - `closed` + more than 1 hour ago → `"Ended Xh ago"`
   - `closed` + less than 1 hour ago → `"Just ended"`
3. THE `src/proposals.ts` module SHALL export a `calcPercentages(scores: number[], scores_total: number): number[]` function that returns an empty array when `scores_total` is 0 or falsy, preventing division by zero.
4. WHEN `scores_total` is greater than 0, THE `calcPercentages` function SHALL return an array of percentages rounded to the nearest integer, where each element equals `Math.round((scores[i] / scores_total) * 100)`.
5. THE `src/proposals.ts` module SHALL export a `transformProposal(raw: RawProposal | null | undefined): DisplayProposal | null` function.
6. WHEN `transformProposal` is called with a null or undefined argument, THE `transformProposal` function SHALL return `null`.
7. WHEN `transformProposal` is called with a valid RawProposal, THE `transformProposal` function SHALL return a DisplayProposal containing: `title` truncated to 80 characters, `bodyPreview` as plain text truncated to 200 characters, `bodyDetail` as plain text truncated to 1000 characters, `percentages` from `calcPercentages`, `timeLabel` from `formatTime`, and `spaceName` from `raw.space.name`.
8. THE `src/proposals.ts` module SHALL export a `formatNumber(n: number): string` function that returns the number formatted with locale-aware thousands separators using `n.toLocaleString()`.
9. WHEN a transformed proposal is `null`, THE Extension SHALL skip rendering that proposal and not include it in the proposals list.
10. WHEN rendering choices and scores in any screen, THE Extension SHALL verify both `choices[i]` and `scores[i]` exist before rendering that entry, skipping any index where either is undefined.
11. THE Extension SHALL always reset `isLoadingProposals` to `false` in a `finally` block, regardless of success, error, or early return from the fetch flow.
12. THE Extension SHALL implement a `renderProposalsList(proposals: DisplayProposal[])` function that renders ProposalCards into the proposals list container using a `DocumentFragment`.
13. WHEN navigating back from the detail screen to the proposals screen, THE Extension SHALL NOT call `fetchProposals` again if `appState.proposals` is already populated.

---

### Requirement 4: "View Proposals" Entry Point

**User Story:** As a connected user, I want a "View Proposals" button on the connected screen, so that I can navigate to the proposals list.

#### Acceptance Criteria

1. THE Popup SHALL render a button with id `btn-proposals` and class `proposals-button` inside the connected state section of `popup/popup.html`.
2. WHEN the user clicks `btn-proposals`, THE Extension SHALL navigate to the `"proposals"` screen.
3. WHEN the user clicks `btn-proposals` and `isLoadingProposals` is `true`, THE Extension SHALL not initiate a second fetch request.
4. WHEN the user clicks `btn-proposals`, THE Extension SHALL set `isLoadingProposals` to `true` before initiating the fetch and set it to `false` upon completion or error.

---

### Requirement 5: Proposals List Screen (Screen 3)

**User Story:** As a connected user, I want to see a scrollable list of governance proposals, so that I can browse what is available.

#### Acceptance Criteria

1. THE Popup SHALL include a screen element with id `screen-proposals` and class `screen` in `popup/popup.html`.
2. THE Screen 3 header SHALL contain a back button with id `btn-back-proposals` and a title element with text "Proposals".
3. WHEN proposals are being fetched, THE Extension SHALL show the element with id `proposals-loading` and hide the list, empty, and error elements.
4. WHEN the fetch returns zero proposals, THE Extension SHALL show the element with id `proposals-empty` and hide the loading, list, and error elements.
5. WHEN the fetch returns an error, THE Extension SHALL show the element with id `proposals-error`, set the text of `proposals-error-msg` to a descriptive error message, and hide the loading, list, and empty elements.
6. WHEN the element with id `btn-retry` is clicked, THE Extension SHALL re-initiate the proposal fetch.
7. WHEN proposals are successfully fetched, THE Extension SHALL render a ProposalCard for each DisplayProposal into the element with id `proposals-list` using a DocumentFragment.
8. EACH ProposalCard SHALL display: a status badge reflecting the proposal state (active, pending, or closed), the DAO space name, the proposal title truncated to 80 characters, the top 2 vote choices with their percentages (only when `scores_total` is greater than 0), and the time label.
9. THE top 2 choices displayed on a ProposalCard SHALL be determined by sorting all choice-percentage pairs descending by percentage and taking the first two.
10. THE top 2 choices sort logic SHALL use: `const pairs = choices.map((c, i) => ({ choice: c, percent: percentages[i] || 0 })); pairs.sort((a, b) => b.percent - a.percent); const topTwo = pairs.slice(0, 2)`.
11. EACH ProposalCard click handler SHALL be assigned as: `card.onclick = () => navigate('detail', { proposal: p })`.
12. THE proposals list container SHALL support vertical scrolling via `overflow-y: auto`.
13. WHEN the user clicks `btn-back-proposals`, THE Extension SHALL navigate to the `"connected"` screen without re-initiating a wallet connection.

---

### Requirement 6: Proposal Detail Screen (Screen 4)

**User Story:** As a connected user, I want to view the full details of a proposal, so that I can understand what I would be voting on.

#### Acceptance Criteria

1. THE Popup SHALL include a screen element with id `screen-detail` and class `screen` in `popup/popup.html`.
2. THE Screen 4 header SHALL contain a back button with id `btn-back-detail`.
3. WHEN Screen 4 is shown, THE Extension SHALL call `renderProposalDetail(appState.selectedProposal)` to populate the element with id `detail-content`.
4. THE ProposalDetail view SHALL display: the DAO space name, the proposal status badge, the full proposal title, the time label, the proposal body as plain text truncated to 1000 characters, a votes section with all choices and their progress bars, the total vote count formatted with `formatNumber`, and vote buttons for each choice.
5. THE progress bar width for each choice SHALL be set to the corresponding percentage value (e.g., `width: 45%`).
6. THE vote buttons SHALL be rendered in a disabled state with `cursor: not-allowed` and SHALL NOT trigger any action when clicked.
7. THE ProposalDetail view SHALL include a note with text "Voting coming in next update".
8. WHEN the user clicks `btn-back-detail`, THE Extension SHALL navigate to the `"proposals"` screen using the cached `appState.proposals` without re-fetching from the SnapshotAPI.

---

### Requirement 7: Content Safety

**User Story:** As a user, I want the extension to safely render proposal content, so that malicious proposal text cannot execute scripts in my browser.

#### Acceptance Criteria

1. THE Extension SHALL NEVER assign proposal-derived content (title, body, choice labels, space name) to any element's `innerHTML` property.
2. THE Extension SHALL assign all proposal-derived text content exclusively via the `textContent` property of DOM elements.
3. `innerHTML` MAY be used ONLY for clearing containers (e.g., `container.innerHTML = ''`), NEVER for inserting API-derived data.

---

### Requirement 8: Visual Design

**User Story:** As a user, I want the proposals UI to match the dark governance aesthetic, so that the extension feels cohesive and professional.

#### Acceptance Criteria

1. THE Popup container SHALL use a dark background color (e.g., `#1a1a2e` or equivalent dark tone) for Screen 3 and Screen 4.
2. THE status badge for an active proposal SHALL use a green border style.
3. THE status badge for a pending proposal SHALL use an amber border style.
4. THE status badge for a closed proposal SHALL use a grey border style.
5. THE progress bar for the first-ranked choice SHALL use a green fill color.
6. THE progress bar for the second-ranked choice SHALL use a red fill color.
7. THE progress bar for all remaining choices SHALL use a grey fill color.
8. THE vote percentage labels SHALL be colored green for the first choice, red for the second, and grey for the rest.
9. THE popup container SHALL allow vertical scrolling via `overflow-y: auto` so that long proposal lists and detail views are fully accessible.
10. THE wallet address and vote count numbers SHALL use a monospace font family.
11. THE popup is approximately 350px wide.

---

### Requirement 9: Build Compatibility

**User Story:** As a developer, I want all new source files to be TypeScript-compatible and bundled via esbuild, so that the build pipeline remains consistent.

#### Acceptance Criteria

1. THE `src/snapshot.ts` file SHALL be valid TypeScript compatible with the project's `tsconfig.json` settings.
2. THE `src/proposals.ts` file SHALL be valid TypeScript compatible with the project's `tsconfig.json` settings.
3. THE build script SHALL be updated to bundle `src/popup.ts` (which imports `src/snapshot.ts` and `src/proposals.ts`) via esbuild into `dist/popup.js`.
4. THE build script SHALL copy `popup/popup.html` and `popup/popup.css` to the `dist/popup/` directory as part of the build.
5. THE Extension SHALL NOT modify `manifest.json`, `src/storage.ts`, `src/messageHandler.ts`, or `hosted-page/src/main.ts`.
