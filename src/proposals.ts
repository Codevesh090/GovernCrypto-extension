import { RawProposal } from './snapshot.js';

export interface DisplayProposal {
  id: string;
  title: string;
  bodyPreview: string;
  bodyDetail: string;
  choices: string[];
  scores: number[];
  percentages: number[];
  scores_total: number;
  state: string;
  timeLabel: string;
  spaceName: string;
  spaceId: string;
  start: number;
  end: number;
  bodyFull: string; // full untruncated body for AI
}

export function stripMarkdown(text: string): string {
  if (!text) return '';
  return text
    .replace(/#{1,6}\s/g, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^>\s*/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, ' ')
    .trim();
}

export function formatTime(unixTimestamp: number, state: string): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = unixTimestamp - now;
  const absDiff = Math.abs(diff);
  const days = Math.floor(absDiff / 86400);
  const hours = Math.floor((absDiff % 86400) / 3600);

  if (state === 'active') {
    if (days > 0) return `Ends in ${days}d ${hours}h`;
    if (hours > 0) return `Ends in ${hours}h`;
    return 'Ending soon';
  }
  if (state === 'pending') {
    if (days > 0) return `Starts in ${days}d ${hours}h`;
    if (hours > 0) return `Starts in ${hours}h`;
    return 'Starting soon';
  }
  // closed
  if (days > 0) return `Ended ${days}d ago`;
  if (hours > 0) return `Ended ${hours}h ago`;
  return 'Just ended';
}

export function calcPercentages(scores: number[], scores_total: number): number[] {
  if (!scores || scores.length === 0 || !scores_total || scores_total === 0) return [];
  return scores.map(s => Math.round((s / scores_total) * 100));
}

export function formatNumber(n: number): string {
  return n.toLocaleString();
}

export function transformProposal(raw: RawProposal | null | undefined): DisplayProposal | null {
  if (!raw) return null;

  const plainBody = stripMarkdown(raw.body || '');
  const percentages = calcPercentages(raw.scores || [], raw.scores_total || 0);
  const title = raw.title || 'Untitled';

  return {
    id: raw.id,
    title: title.length > 80 ? title.slice(0, 80) + '...' : title,
    bodyPreview: plainBody.length > 200 ? plainBody.slice(0, 200) + '...' : plainBody,
    bodyDetail: plainBody.length > 1000 ? plainBody.slice(0, 1000) + '...' : plainBody,
    choices: Array.isArray(raw.choices) ? raw.choices : [],
    scores: Array.isArray(raw.scores) ? raw.scores : [],
    percentages,
    scores_total: raw.scores_total || 0,
    state: raw.state || 'closed',
    timeLabel: formatTime(raw.end, raw.state),
    spaceName: raw.space?.name || raw.space?.id || 'Unknown DAO',
    spaceId: raw.space?.id || '',
    start: raw.start || 0,
    end: raw.end || 0,
    bodyFull: stripMarkdown(raw.body || '').slice(0, 3000) // up to 3000 chars for AI summary
  };
}
