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
 * Full vote flow: build → sign → submit.
 * Throws descriptive errors on each failure mode.
 */
export async function castVote(
  proposalId:   string,
  spaceId:      string,
  choiceIndex:  number,
  voterAddress: string
): Promise<void> {
  // 1. Build payload and typed data
  const payload   = buildVotePayload(proposalId, spaceId, choiceIndex, voterAddress);
  const typedData = buildTypedData(payload);

  // 2. Guard: wallet provider must be available
  const ethereum = (window as any).ethereum;
  if (!ethereum) {
    throw new Error('No wallet provider found');
  }

  // 3. Sign via eth_signTypedData_v4 (NEVER personal_sign)
  let signature: string;
  try {
    signature = await ethereum.request({
      method: 'eth_signTypedData_v4',
      params: [voterAddress, JSON.stringify(typedData)]
    });
  } catch (err: any) {
    // MetaMask rejection: error code 4001
    if (err?.code === 4001 || err?.message?.toLowerCase().includes('user rejected')) {
      throw new Error('Signature rejected');
    }
    throw new Error(`Signing failed: ${err?.message || err}`);
  }

  // 4. Submit to Snapshot relay — do NOT modify typedData after signing
  let response: Response;
  try {
    response = await fetch(SNAPSHOT_RELAY, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        address: voterAddress,
        sig:     signature,
        data:    typedData
      })
    });
  } catch {
    throw new Error('Network error. Please try again.');
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (body.toLowerCase().includes('already voted')) {
      throw new Error('You have already voted on this proposal');
    }
    throw new Error(`Relay error ${response.status}: ${body}`);
  }

  // Check response body for "already voted" even on 200
  const json = await response.json().catch(() => ({}));
  if (json?.error?.toLowerCase?.().includes('already voted')) {
    throw new Error('You have already voted on this proposal');
  }
}
