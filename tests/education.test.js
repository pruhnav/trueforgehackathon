import test from 'node:test';
import assert from 'node:assert/strict';

test('Education lookup filters URLs, caches results, and uses no patient data', async () => {
  const { lookupEducation } = await import('../server/education.js');
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls++;
    assert.equal(url.hostname, 'wsearch.nlm.nih.gov');
    assert.equal(url.searchParams.get('term'), 'title:"Medicines"');
    return new Response(
      '<nlmSearchResult><list><document url="https://medlineplus.gov/medicines.html"><content name="title">Medicines</content></document><document url="https://untrusted.example/test"><content name="title">Untrusted</content></document></list></nlmSearchResult>',
    );
  };
  try {
    const result = await lookupEducation('medication');
    assert.equal(result.mode, 'live');
    assert.equal(result.links.length, 1);
    assert.equal(result.links[0].title, 'Medicines');
    const cached = await lookupEducation('medication');
    assert.equal(cached.cached, true);
    assert.equal(calls, 1);
    await assert.rejects(() => lookupEducation('patient-demo-001'));
  } finally {
    globalThis.fetch = original;
  }
});

test('Education failure falls back without changing the care plan', async () => {
  const { lookupEducation } = await import('../server/education.js');
  const original = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('offline');
  };
  try {
    const result = await lookupEducation('followup');
    assert.equal(result.mode, 'fallback');
    assert.equal(result.retrievedAt, null);
    assert.ok(result.links.length > 0);
    assert.match(result.note, /no patient instructions were changed/);
  } finally {
    globalThis.fetch = original;
  }
});
