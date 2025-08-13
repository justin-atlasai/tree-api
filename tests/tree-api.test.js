import test from 'node:test';
import assert from 'node:assert/strict';

const { GET, POST } = await import('../app/api/tree/route.js');

test('GET /api/tree returns array', async () => {
  const res = await GET(new Request('http://localhost/api/tree'));
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(Array.isArray(data));
});

test('POST /api/tree inserts node', async () => {
  const label = `test-node-${Date.now()}`;
  const res = await POST(
    new Request('http://localhost/api/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentId: 1, label }),
    }),
  );
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.label, label);
});
