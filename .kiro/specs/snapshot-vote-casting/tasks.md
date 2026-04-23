# Implementation Plan: Snapshot Vote Casting (EIP-712)

## Overview

Implement off-chain governance voting by creating the `VoteCaster` module (`src/snapshotVote.ts`), activating vote buttons in `src/popup.ts`, adding the Snapshot relay host permission to `manifest.json`, and adding vote-status styles to `popup/popup.css`. Property-based tests cover all seven correctness properties from the design.

## Tasks

- [x] 1. Add `https://seq.snapshot.org/*` to `host_permissions` in `manifest.json`
  - Open `manifest.json` and append `"https://seq.snapshot.org/*"` to the `host_permissions` array
  - _Requirements: 7.1, 7.2_

- [x] 2. Create `src/snapshotVote.ts` — VoteCaster module
  - [x] 2.1 Define `VotePayload` and `TypedData` interfaces and EIP-712 domain constants
    - Export `VotePayload` interface with fields: `from`, `space`, `timestamp`, `proposal`, `choice`, `reason`, `app`, `metadata`, `type`
    - Export `TypedData` interface with `domain`, `types`, and `message` fields
    - Define `SNAPSHOT_DOMAIN` constant (`name`, `version`, `chainId`, `verifyingContract`)
    - Define `VOTE_TYPE` array with all 8 field descriptors
    - _Requirements: 1.4, 1.5_

  - [x] 2.2 Implement `buildVotePayload(proposalId, spaceId, choiceIndex, voterAddress): VotePayload`
    - Pure function — no I/O
    - Set `type` to `"vote"`, `app` to `"govercrypto"`, `reason` to `""`, `metadata` to `"{}"`
    - Set `timestamp` to `Math.floor(Date.now() / 1000)`
    - _Requirements: 1.1, 1.2, 1.3_

  - [ ]* 2.3 Write property test for `buildVotePayload` — Property 1
    - **Property 1: Vote payload contains all required fields**
    - **Validates: Requirements 1.1, 1.2, 1.3**
    - Generate arbitrary `proposalId`, `spaceId`, `choiceIndex` (1–100), and `voterAddress` (0x-prefixed hex)
    - Assert all required fields are present and correctly mapped

  - [x] 2.4 Implement `buildTypedData(payload: VotePayload): TypedData`
    - Pure function — no I/O
    - Wrap payload in EIP-712 envelope using `SNAPSHOT_DOMAIN` and `VOTE_TYPE`
    - _Requirements: 1.4, 1.5_

  - [ ]* 2.5 Write property test for `buildTypedData` — Property 2
    - **Property 2: EIP-712 typed data structure is always valid**
    - **Validates: Requirements 1.4, 1.5**
    - Generate arbitrary `VotePayload` via `arbitraryVotePayload()` helper
    - Assert domain contains all four required keys; `types.Vote` contains all 8 field names

  - [x] 2.6 Implement `castVote(proposalId, spaceId, choiceIndex, voterAddress): Promise<void>`
    - Call `buildVotePayload` then `buildTypedData`
    - Guard: if `window.ethereum` is undefined, throw `"No wallet provider found"`
    - Call `eth_signTypedData_v4` with `voterAddress` and `JSON.stringify(typedData)`
    - On MetaMask rejection (error code `4001`), throw `"Signature rejected"`
    - POST to `https://seq.snapshot.org/` with `{ address, sig, data: typedData }` and `Content-Type: application/json`
    - On network error, throw `"Network error. Please try again."`
    - On non-2xx response, throw `"Relay error {status}: {body}"`
    - If response body contains `"already voted"`, throw `"You have already voted on this proposal"`
    - _Requirements: 2.1, 2.2, 2.4, 2.5, 3.1, 3.2, 3.4, 3.5_

  - [ ]* 2.7 Write property test for typed data immutability — Property 3
    - **Property 3: Typed data is not mutated between signing and submission**
    - **Validates: Requirements 3.3, 8.3**
    - Mock `window.ethereum` and `fetch`; capture the `data` field sent to `fetch`
    - Assert `JSON.stringify(capturedData) === JSON.stringify(tdBeforeSigning)`

  - [ ]* 2.8 Write property test for submission body structure — Property 4
    - **Property 4: Submission request always contains address, sig, and data**
    - **Validates: Requirements 3.1**
    - Generate arbitrary `address`, `sig`, and `TypedData`; mock `fetch` to capture body
    - Assert captured body has `address`, `sig`, and `data` keys

- [ ] 3. Checkpoint — Ensure all VoteCaster tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Add vote-status styles to `popup/popup.css`
  - Add `.vote-status` rule: small muted text below vote buttons, suitable for success/error messages
  - _Requirements: 5.1, 5.2, 5.3_

- [x] 5. Modify `src/popup.ts` — activate vote buttons and wire vote flow
  - [x] 5.1 Import `castVote` from `./snapshotVote.js` at the top of `popup.ts`
    - Add `import { castVote } from './snapshotVote.js';`
    - _Requirements: 4.1_

  - [x] 5.2 Add `setVoteButtons(container, disabled)` helper function
    - Queries all `.vote-btn` inside `container` and sets `btn.disabled`
    - _Requirements: 5.1, 5.4_

  - [x] 5.3 Add `handleVoteClick(proposal, choiceIndex, buttonsContainer, statusEl)` async function
    - Read `connectedAddress` from `chrome.storage.local`; if missing, set `statusEl.textContent = 'Connect wallet first'` and return
    - Show `window.confirm()` with choice name and proposal title; if cancelled, return
    - Call `setVoteButtons(buttonsContainer, true)` and set `statusEl.textContent = 'Submitting vote...'`
    - `await castVote(proposal.id, proposal.spaceId, choiceIndex, address)`
    - On success: set `statusEl.textContent = 'Vote submitted successfully ✅'`, keep buttons disabled
    - On `"Signature rejected"`: set status text, call `setVoteButtons(buttonsContainer, false)`
    - On `"already voted"`: set status text, keep buttons disabled
    - On any other error: set `statusEl.textContent = 'Vote failed. Please try again.'`, call `setVoteButtons(buttonsContainer, false)`
    - _Requirements: 4.4, 4.5, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 5.4 Update vote buttons section in `renderProposalDetail`
    - Replace `btn.disabled = true` with `btn.disabled = !isActive` (where `isActive = proposal.state === 'active'`)
    - For active proposals, attach `click` listener calling `handleVoteClick(proposal, idx + 1, voteButtons, voteStatus)`
    - Replace the `"Voting coming in next update"` note `<p>` with a `<p class="vote-status">` element (empty text)
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 5.5 Write property test for active proposals rendering enabled buttons — Property 5
    - **Property 5: Active proposals render enabled vote buttons**
    - **Validates: Requirements 4.1**
    - Generate arbitrary active `DisplayProposal` with 1–10 non-empty choices
    - Call `renderProposalDetail(proposal)` in a jsdom environment
    - Assert button count equals `choices.filter(Boolean).length` and all buttons are not disabled

  - [ ]* 5.6 Write property test for non-active proposals rendering disabled buttons — Property 6
    - **Property 6: Non-active proposals render disabled vote buttons**
    - **Validates: Requirements 4.2, 6.6**
    - Generate arbitrary `DisplayProposal` with state `"closed"` or `"pending"` and 1–10 non-empty choices
    - Assert all rendered `.vote-btn` elements are disabled

  - [ ]* 5.7 Write property test for error safety — Property 7
    - **Property 7: Unhandled errors always produce a safe UI state**
    - **Validates: Requirements 6.5**
    - Mock `castVote` to throw an arbitrary error message
    - Call `handleVoteClick` and assert `statusEl.textContent` is non-empty
    - Assert buttons are re-enabled unless error message includes `"already voted"`

- [ ] 6. Create `tests/snapshotVote.test.ts` — property-based test file
  - Install `fast-check` as a dev dependency if not already present (`npm install --save-dev fast-check vitest`)
  - Implement `arbitraryVotePayload()` and `arbitraryTypedData()` arbitraries
  - Implement all property tests from tasks 2.3, 2.5, 2.7, 2.8, 5.5, 5.6, 5.7 in this single file
  - Each `fc.assert` call runs a minimum of 100 iterations (`{ numRuns: 100 }`)
  - _Requirements: 1.1–1.5, 2.1, 3.1, 3.3, 4.1, 4.2, 6.5, 8.3_

- [ ] 7. Final checkpoint — Ensure all tests pass
  - Run `npx vitest --run` and confirm all property tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Property tests validate universal correctness properties using fast-check (min 100 runs each)
- Unit tests validate specific examples and error paths
- `castVote` is the only async function in `snapshotVote.ts`; `buildVotePayload` and `buildTypedData` are pure and synchronous
