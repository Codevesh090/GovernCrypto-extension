/**
 * Feature 5: Cast Vote via Snapshot (EIP-712 Signing)
 *
 * Snapshot uses off-chain signed messages — no gas, no blockchain transaction.
 * Flow: build payload → wrap in EIP-712 → sign via MetaMask → POST to relay
 */

// ============================================
// Interfaces
// ============================================

export interface VotePayload {
  from:      string;  // voter's Ethereum address
  space:     string;  // Snapshot space ID (e.g. "ens.eth")
  timestamp: number;  // Unix seconds
  proposal:  string;  // Snapshot proposal ID
  choice:    number;  // 1-based index into proposal.choices[]
  reason:    string;  // always ""
  app:       string;  // always "govercrypto"
  metadata:  string;  // always "{}"
  type:      string;  // always "vote"
}

export interface TypedData {
  domain: {
    name:              string;
    version:           string;
    chainId:           number;
    verifyingContract: string;
  };
  types: {
    Vote: Array<{ name: string; type: string }>;
  };
  primaryType: string;
  message:     VotePayload;
}

// ============================================
// EIP-712 Constants (Snapshot's fixed domain)
// ============================================

const SNAPSHOT_DOMAIN = {
  name:              'snapshot',
  version:           '0.1.4',
  chainId:           1,
  verifyingContract: '0xC4cDb0a651724D7DB1b3b2F08b8bF61b5a33952D'
};

const VOTE_TYPE: Array<{ name: string; type: string }> = [
  { name: 'from',      type: 'address' },
  { name: 'space',     type: 'string'  },
  { name: 'timestamp', type: 'uint64'  },
  { name: 'proposal',  type: 'bytes32' },
  { name: 'choice',    type: 'uint32'  },
  { name: 'reason',    type: 'string'  },
  { name: 'app',       type: 'string'  },
  { name: 'metadata',  type: 'string'  },
];

const SNAPSHOT_RELAY = 'https://seq.snapshot.org/';

const SIGN_PAGE_URL = 'https://codevesh090.github.io/GovernCrypto-extension/sign.html';

/**
 * Opens the hosted sign page (localhost:3000) where MetaMask IS injected.
 * Passes proposalId + choice via URL params.
 * Resolves when VOTE_SUCCESS postMessage is received back.
 */
export function castVoteViaTab(
  proposalId:  string,
  choiceIndex: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${SIGN_PAGE_URL}?proposalId=${encodeURIComponent(proposalId)}&choice=${choiceIndex}`;
    const tab = window.open(url, '_blank');

    if (!tab) {
      reject(new Error('Could not open signing tab. Please allow popups for this extension.'));
      return;
    }

    const timeout = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('Vote signing timed out.'));
    }, 300000);

    function onMessage(event: MessageEvent) {
      // Accept messages from GitHub Pages
      if (event.origin !== 'https://codevesh090.github.io') return;
      const msg = event.data;
      if (!msg) return;

      if (msg.type === 'VOTE_SUCCESS' && msg.proposalId === proposalId) {
        window.removeEventListener('message', onMessage);
        clearTimeout(timeout);
        resolve();
      }
    }

    window.addEventListener('message', onMessage);
  });
}

// ============================================
// Pure Functions
// ============================================

/**
 * Builds the Vote_Payload from proposal context and user choice.
 * Pure function — no I/O.
 */
export function buildVotePayload(
  proposalId:   string,
  spaceId:      string,
  choiceIndex:  number,  // 1-based
  voterAddress: string
): VotePayload {
  return {
    from:      voterAddress,
    space:     spaceId,
    timestamp: Math.floor(Date.now() / 1000),
    proposal:  proposalId,
    choice:    choiceIndex,
    reason:    '',
    app:       'govercrypto',
    metadata:  '{}',
    type:      'vote'
  };
}

/**
 * Wraps a VotePayload in the EIP-712 TypedData envelope.
 * Pure function — no I/O.
 */
export function buildTypedData(payload: VotePayload): TypedData {
  return {
    domain:      SNAPSHOT_DOMAIN,
    types:       { Vote: VOTE_TYPE },
    primaryType: 'Vote',
    message:     payload
  };
}

// ============================================
// Orchestrator
// ============================================

/**
 * Full vote flow: opens the sign-vote tab which handles
 * wallet connection, EIP-712 signing, and Snapshot relay submission.
 */
export async function castVote(
  proposalId:   string,
  _spaceId:     string,
  choiceIndex:  number,
  _voterAddress: string
): Promise<void> {
  await castVoteViaTab(proposalId, choiceIndex);
}
