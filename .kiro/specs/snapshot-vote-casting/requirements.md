# Requirements Document

## Introduction

Feature 5 adds off-chain governance voting to the GovernCrypto Chrome extension. Users can cast a For/Against/Abstain vote on any active Snapshot proposal directly from the extension side panel. The vote is signed via EIP-712 typed data (eth_signTypedData_v4) using the connected MetaMask wallet and submitted to the Snapshot sequencer relay at `https://seq.snapshot.org/`. No blockchain transaction is required. This feature is purely additive — it enables the existing disabled vote buttons in the proposal detail view without modifying `storage.ts`, `snapshot.ts`, or `proposals.ts`.

## Glossary

- **VoteCaster**: The new module (`src/snapshotVote.ts`) responsible for building, signing, and submitting votes.
- **EIP-712**: Ethereum typed structured data signing standard used by Snapshot for off-chain votes.
- **Typed_Data**: The EIP-712 structured object passed to `eth_signTypedData_v4` for user signing.
- **Vote_Payload**: The structured vote object containing proposal ID, choice index, space ID, and metadata.
- **Snapshot_Relay**: The Snapshot sequencer endpoint at `https://seq.snapshot.org/` that records signed votes.
- **Provider**: The `window.ethereum` injected object exposed by MetaMask in extension pages.
- **Connected_Address**: The Ethereum address stored in `chrome.storage.local` under the key `connectedAddress`.
- **Choice_Index**: The 1-based integer index of the selected choice within `DisplayProposal.choices[]`.
- **Vote_Button**: A button rendered in the proposal detail view for each entry in `DisplayProposal.choices[]`.
- **Popup_UI**: The extension side panel rendered via `popup/popup.html` and driven by `src/popup.ts`.

---

## Requirements

### Requirement 1: Vote Payload Construction

**User Story:** As a governance participant, I want the extension to build a correctly structured vote payload, so that my vote can be signed and accepted by the Snapshot relay.

#### Acceptance Criteria

1. WHEN a user selects a choice on an active proposal, THE VoteCaster SHALL build a Vote_Payload containing the proposal ID, the 1-based Choice_Index, the space ID, the voter's Connected_Address, and a Unix timestamp.
2. THE VoteCaster SHALL set the `type` field of the Vote_Payload to `"vote"`.
3. THE VoteCaster SHALL set the `app` field of the Vote_Payload to `"govercrypto"`.
4. WHEN the Vote_Payload is built, THE VoteCaster SHALL construct a Typed_Data object conforming to the EIP-712 domain structure used by Snapshot, including `name`, `version`, `chainId`, and `verifyingContract` domain fields.
5. THE VoteCaster SHALL include the `Vote` type definition in the Typed_Data `types` field with fields: `from`, `space`, `timestamp`, `proposal`, `choice`, `reason`, `app`, and `metadata`.

---

### Requirement 2: EIP-712 Signing

**User Story:** As a wallet holder, I want the extension to request my signature using the standard EIP-712 method, so that my vote is cryptographically authenticated without exposing my private key.

#### Acceptance Criteria

1. WHEN a Vote_Payload is ready, THE VoteCaster SHALL request a signature by calling `eth_signTypedData_v4` on the Provider with the Connected_Address and the JSON-serialised Typed_Data.
2. THE VoteCaster SHALL use `eth_signTypedData_v4` exclusively and SHALL NOT use `personal_sign` or any other signing method.
3. THE VoteCaster SHALL NOT log, store, or transmit the raw private key at any point.
4. IF the Provider is unavailable or `window.ethereum` is undefined, THEN THE VoteCaster SHALL throw an error with the message `"No wallet provider found"`.
5. IF the user rejects the signature request in the wallet popup, THEN THE VoteCaster SHALL throw an error with the message `"Signature rejected"`.

---

### Requirement 3: Vote Submission to Snapshot Relay

**User Story:** As a governance participant, I want my signed vote to be submitted to Snapshot, so that it is recorded on the proposal.

#### Acceptance Criteria

1. WHEN a valid signature is obtained, THE VoteCaster SHALL submit a POST request to `https://seq.snapshot.org/` with a JSON body containing `address`, `sig`, and `data` fields.
2. THE VoteCaster SHALL set the `Content-Type` header to `application/json` on the submission request.
3. THE VoteCaster SHALL NOT modify the Typed_Data or Vote_Payload after the signature has been obtained.
4. IF the Snapshot_Relay returns a non-2xx HTTP status, THEN THE VoteCaster SHALL throw an error containing the HTTP status code and response body.
5. IF a network error occurs during submission, THEN THE VoteCaster SHALL throw an error with the message `"Network error. Please try again."`.

---

### Requirement 4: Vote Button Activation

**User Story:** As a user viewing an active proposal, I want the vote buttons to be clickable, so that I can cast my vote without leaving the extension.

#### Acceptance Criteria

1. WHEN the proposal detail view renders an active proposal, THE Popup_UI SHALL render each choice as an enabled Vote_Button.
2. WHEN the proposal detail view renders a closed or pending proposal, THE Popup_UI SHALL render each choice as a disabled Vote_Button.
3. THE Popup_UI SHALL remove the "Voting coming in next update" note when vote buttons are enabled for an active proposal.
4. WHEN a Vote_Button is clicked, THE Popup_UI SHALL display a confirmation dialog asking the user to confirm their choice before proceeding.
5. IF the user cancels the confirmation dialog, THEN THE Popup_UI SHALL return to the idle state without initiating any signing request.

---

### Requirement 5: Vote UI State Management

**User Story:** As a user casting a vote, I want clear visual feedback at each stage of the voting process, so that I know whether my vote succeeded or failed.

#### Acceptance Criteria

1. WHEN a vote submission is in progress, THE Popup_UI SHALL display the text `"Submitting vote..."` and disable all Vote_Buttons.
2. WHEN a vote is successfully submitted, THE Popup_UI SHALL display the text `"Vote submitted successfully ✅"` and disable all Vote_Buttons.
3. WHEN a vote submission fails, THE Popup_UI SHALL display the text `"Vote failed. Please try again."` and re-enable all Vote_Buttons.
4. WHILE a vote submission is in progress, THE Popup_UI SHALL prevent duplicate vote submissions by disabling all Vote_Buttons.

---

### Requirement 6: Edge Case and Error Handling

**User Story:** As a user, I want the extension to handle error conditions gracefully, so that I always receive a clear message and the extension never crashes.

#### Acceptance Criteria

1. IF the Connected_Address is not set when a Vote_Button is clicked, THEN THE Popup_UI SHALL display the message `"Connect wallet first"` and SHALL NOT initiate a signing request.
2. IF the user rejects the signature in the wallet popup, THEN THE Popup_UI SHALL display the message `"Signature rejected"` and re-enable all Vote_Buttons.
3. IF a network error occurs during vote submission, THEN THE Popup_UI SHALL display the message `"Vote failed. Please try again."` and offer a retry option.
4. IF the Snapshot_Relay returns an error indicating the user has already voted, THEN THE Popup_UI SHALL display the message `"You have already voted on this proposal"` and disable all Vote_Buttons.
5. IF an unhandled exception occurs during the vote flow, THEN THE Popup_UI SHALL catch the error, display `"Vote failed. Please try again."`, and SHALL NOT crash or freeze the extension panel.
6. WHEN a Vote_Button is clicked on a closed proposal, THE Popup_UI SHALL keep the button disabled and SHALL NOT initiate any vote flow.

---

### Requirement 7: Manifest and Network Permissions

**User Story:** As a developer, I want the extension manifest to declare the Snapshot relay host permission, so that the browser allows the vote submission network request.

#### Acceptance Criteria

1. THE extension manifest SHALL include `"https://seq.snapshot.org/*"` in the `host_permissions` array.
2. WHEN the vote submission fetch is made to `https://seq.snapshot.org/`, THE browser SHALL not block the request due to missing host permissions.

---

### Requirement 8: Security Constraints

**User Story:** As a security-conscious user, I want the extension to follow safe signing practices, so that my wallet credentials are never exposed.

#### Acceptance Criteria

1. THE VoteCaster SHALL use `eth_signTypedData_v4` for all vote signing operations.
2. THE VoteCaster SHALL NOT log private keys, mnemonics, or raw signature inputs to the console.
3. THE VoteCaster SHALL NOT alter the Typed_Data object between the point of signing and the point of submission.
4. THE VoteCaster SHALL NOT use `personal_sign`, `eth_sign`, or any deprecated signing method.
