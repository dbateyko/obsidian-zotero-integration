import matter from 'gray-matter';
import {
  parseBibToMetadataMap,
  diffMetadata,
  patchFrontmatterContent,
} from '../bibSync';

describe('parseBibToMetadataMap', () => {
  const sampleBib = `@article{key1,
    title={Sample Title},
    author={First Author and Second Author},
    year={2021},
}
@book{key2,
    title="Another Title",
    publisher={Pub Name},
}`;

  it('should parse citation keys and fields', () => {
    const meta = parseBibToMetadataMap(sampleBib);
    expect(Object.keys(meta).sort()).toEqual(['key1', 'key2']);
    expect(meta.key1).toMatchObject({
      title: 'Sample Title',
      author: 'First Author and Second Author',
      year: '2021',
    });
    expect(meta.key2).toMatchObject({
      title: 'Another Title',
      publisher: 'Pub Name',
    });
  });
});

describe('diffMetadata', () => {
  it('should return only changed fields for changed entries', () => {
    const oldMap = {
      k1: { a: '1', b: '2' },
      k2: { x: 'y' },
    };
    const newMap = {
      k1: { a: '1', b: '3' },
      k2: { x: 'y' },
      k3: { z: 'z' },
    };
    const diffs = diffMetadata(oldMap, newMap);
    expect(diffs).toEqual({
      k1: { b: '3' },
      k3: { z: 'z' },
    });
  });
});

describe('patchFrontmatterContent', () => {
  it('should update existing frontmatter fields and add new ones', () => {
    const initial = `---
title: Old Title
author: OldAuthor
---
# Content here
`;
    const updated = patchFrontmatterContent(initial, {
      title: 'New Title',
      newField: 'newValue',
    });
    const parsed = matter(updated);
    expect(parsed.data).toMatchObject({
      title: 'New Title',
      author: 'OldAuthor',
      newField: 'newValue',
    });
    expect(parsed.content.trim()).toBe('# Content here');
  });
});