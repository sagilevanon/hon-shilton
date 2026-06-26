import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseFeed } from './rss.js';

describe('rss feed parsing', () => {
  const sample = `<?xml version='1.0' encoding='utf-8' ?>
<rss version="2.0"><channel>
  <title><![CDATA[ynet - חדשות]]></title>
  <image><link><![CDATA[https://www.ynet.co.il/news]]></link></image>
  <item>
    <title><![CDATA[כותרת אחת]]></title>
    <link><![CDATA[https://www.ynet.co.il/news/article/aaa]]></link>
    <tags><![CDATA[בחירות , מפכ"ל , נעם סולברג]]></tags>
  </item>
  <item>
    <title><![CDATA[כותרת שתיים]]></title>
    <link><![CDATA[https://www.ynet.co.il/news/article/bbb]]></link>
  </item>
  <item>
    <title><![CDATA[ללא קישור]]></title>
  </item>
</channel></rss>`;

  it('extracts items with url, title, and comma-split tags', () => {
    const items = parseFeed(sample);
    assert.equal(items.length, 2);
    assert.equal(items[0].url, 'https://www.ynet.co.il/news/article/aaa');
    assert.equal(items[0].title, 'כותרת אחת');
    assert.deepEqual(items[0].tags, ['בחירות', 'מפכ"ל', 'נעם סולברג']);
  });

  it('defaults tags to empty when the element is absent', () => {
    assert.deepEqual(parseFeed(sample)[1].tags, []);
  });

  it('drops items without a link and ignores the channel-level image link', () => {
    assert.ok(parseFeed(sample).every((i) => i.url.includes('/article/')));
  });
});
