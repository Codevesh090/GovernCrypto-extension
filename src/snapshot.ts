export interface RawProposal {
  id: string;
  title: string;
  body: string;
  choices: string[];
  start: number;
  end: number;
  state: string;
  scores: number[];
  scores_total: number;
  space: { id: string; name: string };
}

const SNAPSHOT_API = 'https://hub.snapshot.org/graphql';
export const DEFAULT_SPACE = 'uniswapgovernance.eth';

// 10 most famous DAOs with fallback spaces
export const DAO_FALLBACKS: Record<string, string[]> = {
  'ens.eth':                   ['ens.eth'],
  'uniswapgovernance.eth':     ['uniswapgovernance.eth'],
  'aave.eth':                  ['aave.eth', 'aavegotchi.eth'],
  'makerdao.eth':              ['makerdao.eth', 'makergov.eth'],
  'compound-governance.eth':   ['compound-governance.eth', 'comp-vote.eth'],
  'curve.eth':                 ['curve.eth', 'cvx.eth'],
  'balancer.eth':              ['balancer.eth'],
  'sushigov.eth':              ['sushigov.eth', 'sushi.eth'],
  'gitcoindao.eth':            ['gitcoindao.eth', 'gitcoin.eth'],
  'arbitrumfoundation.eth':    ['arbitrumfoundation.eth']
};

export const DAO_TABS = [
  { id: 'all',                        label: 'ALL' },
  { id: 'ens.eth',                    label: 'ENS' },
  { id: 'uniswapgovernance.eth',      label: 'UNISWAP' },
  { id: 'aave.eth',                   label: 'AAVE' },
  { id: 'makerdao.eth',               label: 'MAKER' },
  { id: 'compound-governance.eth',    label: 'COMPOUND' },
  { id: 'curve.eth',                  label: 'CURVE' },
  { id: 'balancer.eth',               label: 'BALANCER' },
  { id: 'sushigov.eth',               label: 'SUSHI' },
  { id: 'gitcoindao.eth',             label: 'GITCOIN' },
  { id: 'arbitrumfoundation.eth',     label: 'ARBITRUM' }
];

// Shared fetch helper
async function fetchGraphQL(body: object): Promise<RawProposal[]> {
  const res = await fetch(SNAPSHOT_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!res.ok) throw new Error(`HTTP error: ${res.status}`);

  const json = await res.json();
  if (json.errors) throw new Error(json.errors[0].message);

  return json.data.proposals as RawProposal[];
}

// Fetch 40 active proposals from ALL DAOs with pagination
export async function fetchAllActiveProposals(skip: number = 0): Promise<RawProposal[]> {
  const query = `{
    proposals(
      first: 40,
      skip: ${skip},
      where: { state: "active" },
      orderBy: "end",
      orderDirection: asc
    ) {
      id title body choices start end state
      scores scores_total
      space { id name }
    }
  }`;
  return fetchGraphQL({ query });
}

// Fetch 5 latest proposals for a specific space with pagination
async function fetchProposalsBySpace(spaceId: string, skip: number = 0): Promise<RawProposal[]> {
  const query = `
    query GetDAOProposals($space: String!, $skip: Int!) {
      proposals(
        first: 20,
        skip: $skip,
        where: { space: $space },
        orderBy: "created",
        orderDirection: desc
      ) {
        id title body choices start end state
        scores scores_total
        space { id name }
      }
    }
  `;
  return fetchGraphQL({ query, variables: { space: spaceId, skip } });
}

// Fetch with fallback — tries each space until one returns data
export async function fetchDAOProposals(spaceKey: string, skip: number = 0): Promise<RawProposal[]> {
  const spaces = DAO_FALLBACKS[spaceKey] || [spaceKey];

  // console.log('DAO:', spaceKey, '→ trying spaces:', spaces);

  for (const space of spaces) {
    try {
      const data = await fetchProposalsBySpace(space, skip);
      if (Array.isArray(data) && data.length > 0) {
        // console.log(`Proposals fetched from ${space}:`, data.length);
        return data;
      }
      // console.warn(`Empty response from ${space}, trying next...`);
    } catch (err) {
      // console.warn(`Failed for ${space}:`, err);
    }
  }

  // console.warn(`All fallbacks exhausted for ${spaceKey}`);
  return [];
}

// Keep fetchProposals exported for backward compatibility
export async function fetchProposals(spaceId: string = DEFAULT_SPACE): Promise<RawProposal[]> {
  return fetchProposalsBySpace(spaceId);
}
