// What a phone would mark as a link in a text: a web address with or without its scheme
// ("https://coral.example/pay", "coral.example/pay"). The kit shows it underlined and not clickable, as
// a phone shows a link from an unknown sender. A trailing full stop or bracket isn't part of the link.

const LINK = /\b(?:https?:\/\/[^\s<>"]+|(?:www\.)?[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/[^\s<>"]*)?)/gi;
const TRAILING = /[.,;:!?'")\]]+$/;

export interface TextRun {
  text: string;
  link: boolean;
}

/** The text cut into runs of plain text and links, in order. Joined, the runs are the text. */
export function linkRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let at = 0;
  for (const match of text.matchAll(LINK)) {
    const start = match.index ?? 0;
    // An address inside a word (an email's domain) isn't a link on its own.
    if (start > 0 && /[@\w]/.test(text[start - 1]!)) continue;
    const link = match[0].replace(TRAILING, "");
    if (!link) continue;
    if (start > at) runs.push({ text: text.slice(at, start), link: false });
    runs.push({ text: link, link: true });
    at = start + link.length;
  }
  if (at < text.length) runs.push({ text: text.slice(at), link: false });
  return runs;
}
