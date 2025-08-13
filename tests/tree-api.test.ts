/* eslint-env jest */

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.com";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";

const nodes: { id: number; label: string; parent_id: number | null }[] = [
  { id: 1, label: "root", parent_id: null },
];

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    from: () => ({
      select: () => Promise.resolve({ data: [...nodes], error: null }),
      insert: ({
        label,
        parent_id,
      }: {
        label: string;
        parent_id: number | null;
      }) => ({
        select: () => ({
          single: () => {
            const node = { id: nodes.length + 1, label, parent_id };
            nodes.push(node);
            return Promise.resolve({ data: node, error: null });
          },
        }),
      }),
      delete: () => ({
        eq: (_col: string, id: number) => ({
          select: () => ({
            single: () => {
              const index = nodes.findIndex((n) => n.id === id);
              const [removed] = nodes.splice(index, 1);
              return Promise.resolve({ data: removed, error: null });
            },
          }),
        }),
      }),
    }),
  }),
}));

jest.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => {},
  }),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { GET, POST, DELETE: DELETE_NODE } = require("../app/api/tree/route");

describe("tree API", () => {
  test("GET /api/tree returns array", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data)).toBe(true);
  });

  test("POST /api/tree inserts node", async () => {
    const label = `test-node-${Date.now()}`;
    const res = await POST(
      new Request("http://localhost/api/tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: 1, label }),
      }),
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.label).toBe(label);
  });

  test("DELETE /api/tree removes node", async () => {
    const label = `test-delete-${Date.now()}`;
    const createRes = await POST(
      new Request("http://localhost/api/tree", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parentId: null, label }),
      }),
    );
    const created = await createRes.json();
    const deleteRes = await DELETE_NODE(
      new Request("http://localhost/api/tree", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: created.id }),
      }),
    );
    expect(deleteRes.status).toBe(200);
    const deleted = await deleteRes.json();
    expect(deleted.id).toBe(created.id);
  });
});
