import matter from 'gray-matter';

export function parseBibToMetadataMap(bibContent: string): Record<string, Record<string, any>> {
  const map: Record<string, Record<string, any>> = {};
  const entryRegex = /@[^{]+\{([^,]+),([^@]*)/g;
  let entryMatch: RegExpExecArray | null;
  while ((entryMatch = entryRegex.exec(bibContent))) {
    const citekey = entryMatch[1].trim();
    const body = entryMatch[2];
    const metadata: Record<string, any> = {};
    const fieldRegex = /([a-zA-Z]+)\s*=\s*(?:\{([^}]*)\}|"([^"]*)")/g;
    let fieldMatch: RegExpExecArray | null;
    while ((fieldMatch = fieldRegex.exec(body))) {
      const field = fieldMatch[1].toLowerCase();
      const value = fieldMatch[2] !== undefined ? fieldMatch[2] : fieldMatch[3];
      metadata[field] = value || '';
    }
    map[citekey] = metadata;
  }
  return map;
}

export function diffMetadata(
  oldMap: Record<string, Record<string, any>>,
  newMap: Record<string, Record<string, any>>
): Record<string, Record<string, any>> {
  const diffs: Record<string, Record<string, any>> = {};
  for (const citekey of Object.keys(newMap)) {
    const oldMeta = oldMap[citekey] || {};
    const newMeta = newMap[citekey] || {};
    const changed: Record<string, any> = {};
    for (const field of Object.keys(newMeta)) {
      if (oldMeta[field] !== newMeta[field]) {
        changed[field] = newMeta[field];
      }
    }
    if (Object.keys(changed).length > 0) {
      diffs[citekey] = changed;
    }
  }
  return diffs;
}

export function patchFrontmatterContent(
  fileContent: string,
  updatedFields: Record<string, any>
): string {
  const parsed = matter(fileContent);
  const data = { ...parsed.data, ...updatedFields };
  return matter.stringify(parsed.content, data);
}