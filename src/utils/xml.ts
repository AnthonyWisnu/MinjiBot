const INVALID_XML_CHARS_REGEX =
  // eslint-disable-next-line no-control-regex
  /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

const graphemeSegmenter =
  typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

export function splitGraphemes(input: string): string[] {
  if (!input) {
    return [];
  }
  if (graphemeSegmenter) {
    return Array.from(graphemeSegmenter.segment(input), (seg) => seg.segment);
  }
  return Array.from(input);
}

export function stripInvalidXmlChars(input: string): string {
  return input.replace(INVALID_XML_CHARS_REGEX, "");
}

export function escapeXml(input: string): string {
  return stripInvalidXmlChars(input)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function codePointLength(input: string): number {
  return splitGraphemes(input).length;
}

export function clampText(input: string, maxChars: number, ellipsis = "\u2026"): string {
  const clean = stripInvalidXmlChars(input).trim();
  if (maxChars <= 0) {
    return "";
  }

  const chars = splitGraphemes(clean);
  if (chars.length <= maxChars) {
    return clean;
  }

  if (!ellipsis) {
    return chars.slice(0, maxChars).join("");
  }

  const ellipsisChars = splitGraphemes(ellipsis);
  const keepCount = Math.max(0, maxChars - ellipsisChars.length);
  return `${chars.slice(0, keepCount).join("").trimEnd()}${ellipsis}`;
}

export function splitLongToken(token: string, maxCharsPerLine: number): string[] {
  const chars = splitGraphemes(token);
  if (chars.length <= maxCharsPerLine) {
    return [token];
  }

  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += maxCharsPerLine) {
    chunks.push(chars.slice(index, index + maxCharsPerLine).join(""));
  }
  return chunks;
}

export interface WrapSvgTextOptions {
  maxTotalChars: number;
  maxCharsPerLine: number;
  maxLines: number;
  preserveNewlines?: boolean;
}

export function clampAndWrapText(
  text: string,
  maxTotalChars: number,
  maxCharsPerLine: number,
  maxLines: number,
  preserveNewlines = false,
): string[] {
  const safeMaxCharsPerLine = Math.max(1, maxCharsPerLine);
  const safeMaxLines = Math.max(1, maxLines);

  const normalizedInput = preserveNewlines
    ? stripInvalidXmlChars(text).replace(/\r\n?/g, "\n").trim()
    : stripInvalidXmlChars(text).replace(/\s+/g, " ").trim();

  const clamped = clampText(normalizedInput, maxTotalChars);
  if (!clamped) {
    return [];
  }

  const paragraphs = preserveNewlines ? clamped.split("\n") : [clamped];
  const rawLines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0)
      .flatMap((word) => splitLongToken(word, safeMaxCharsPerLine));

    if (words.length === 0) {
      if (preserveNewlines && rawLines.length > 0) {
        rawLines.push("");
      }
      continue;
    }

    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (codePointLength(candidate) <= safeMaxCharsPerLine) {
        current = candidate;
      } else {
        if (current) {
          rawLines.push(current);
        }
        current = word;
      }
    }

    if (current) {
      rawLines.push(current);
    }
  }

  if (rawLines.length <= safeMaxLines) {
    return rawLines;
  }

  const truncated = rawLines.slice(0, safeMaxLines);
  const lastIndex = safeMaxLines - 1;
  const lastLine = truncated[lastIndex] ?? "";
  if (!lastLine.endsWith("\u2026")) {
    const chars = splitGraphemes(lastLine);
    const maxChars = Math.max(0, safeMaxCharsPerLine - 1);
    truncated[lastIndex] = `${chars.slice(0, maxChars).join("").trimEnd()}\u2026`;
  }
  return truncated;
}
