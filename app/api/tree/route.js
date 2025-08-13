import { NextResponse } from "next/server.js";
import { createServerClient } from "@supabase/ssr";

function getClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY,
    {
      cookies: {
        getAll: () => [],
        setAll: () => {},
      },
    },
  );
}

function buildTree(nodes) {
  const map = new Map();
  nodes.forEach((n) => {
    map.set(n.id, { id: n.id, label: n.label, children: [], parent_id: n.parent_id });
  });
  const roots = [];
  map.forEach((node) => {
    if (node.parent_id) {
      const parent = map.get(node.parent_id);
      if (parent) {
        parent.children.push(node);
      }
    } else {
      roots.push(node);
    }
  });
  const removeParent = (n) => {
    const { id, label, children } = n;
    return { id, label, children: children.map((c) => removeParent(c)) };
  };
  return roots.map((r) => removeParent(r));
}

export async function GET() {
  const supabase = getClient();
  const { data, error } = await supabase.from("tree_nodes").select();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const tree = buildTree(data || []);
  return NextResponse.json(tree);
}

export async function POST(req) {
  const { label, parentId } = await req.json();
  const supabase = getClient();
  const { data, error } = await supabase
    .from("tree_nodes")
    .insert({ label, parent_id: parentId })
    .select()
    .single();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json(data);
}
