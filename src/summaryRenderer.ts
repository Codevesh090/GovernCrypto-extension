const SUMMARY_HEADINGS = [
  '**What this proposal wants:**',
  '**Why it matters:**',
  '**In simple terms:**',
  '**Vote type:**',
  '**What a YES vote means:**',
  '**What a NO vote means:**'
];

export interface SummarySection {
  heading: string;
  content: string;
}

export function parseSummary(summaryText: string): SummarySection[] {
  if (!summaryText || !summaryText.trim()) return [];

  const sections: SummarySection[] = [];
  const lines = summaryText.split('\n');
  let currentHeading: string | null = null;
  let currentContent: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim().replace(/\s+/g, ' ');
    if (!trimmed) continue;

    const matchedHeading = SUMMARY_HEADINGS.find(h =>
      trimmed.toLowerCase().startsWith(h.toLowerCase())
    );

    if (matchedHeading) {
      if (currentHeading !== null) {
        sections.push({
          heading: currentHeading.replace(/\*\*/g, '').trim(),
          content: currentContent.join(' ').trim()
        });
      }
      currentHeading = matchedHeading;
      currentContent = [];

      const inline = trimmed.slice(matchedHeading.length).trim();
      if (inline) currentContent.push(inline);
    } else if (currentHeading !== null) {
      const contentLine = trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed;
      if (contentLine) currentContent.push(contentLine);
    }
  }

  if (currentHeading !== null) {
    sections.push({
      heading: currentHeading.replace(/\*\*/g, '').trim(),
      content: currentContent.join(' ').trim()
    });
  }

  return sections;
}

export function renderSummary(sections: SummarySection[], containerEl: HTMLElement): void {
  containerEl.innerHTML = ''; // safe — clearing container only

  const fragment = document.createDocumentFragment();

  for (const section of sections) {
    const wrapper = document.createElement('div');
    wrapper.className = 'summary-section';

    const heading = document.createElement('span');
    heading.className = 'summary-heading';
    heading.textContent = section.heading; // textContent — safe

    const content = document.createElement('p');
    content.className = 'summary-content';

    const headingLower = section.heading.toLowerCase();

    if (headingLower.includes('in simple terms')) {
      content.className += ' summary-quote';
      content.textContent = section.content;
    } else if (headingLower.includes('yes vote')) {
      const tag = document.createElement('span');
      tag.className = 'vote-tag vote-tag-yes';
      tag.textContent = 'YES';
      content.appendChild(tag);
      content.appendChild(document.createTextNode(section.content));
    } else if (headingLower.includes('no vote')) {
      const tag = document.createElement('span');
      tag.className = 'vote-tag vote-tag-no';
      tag.textContent = 'NO';
      content.appendChild(tag);
      content.appendChild(document.createTextNode(section.content));
    } else {
      content.textContent = section.content;
    }

    wrapper.appendChild(heading);
    wrapper.appendChild(content);
    fragment.appendChild(wrapper);
  }

  containerEl.appendChild(fragment);
}

export function getFallbackSummary(bodyText: string): string {
  if (!bodyText || bodyText.trim().length === 0) {
    return 'No description available for this proposal.';
  }

  const sentences = bodyText
    .replace(/\n+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .filter(s => s.trim().length > 0);

  const first3 = sentences.slice(0, 3).join(' ');
  const truncated = first3.length > 300 ? first3.slice(0, 300) + '...' : first3;

  return truncated || bodyText.slice(0, 300);
}
