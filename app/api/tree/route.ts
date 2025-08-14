import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

type Id = string | number;

type NodeRow = {
  id: Id;
  label: string;
  parent_id: Id | null;
};

type TreeNode = {
  id: Id;
  label: string;
  children: TreeNode[];
};

async function getClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_OR_ANON_KEY;

  if (!url || !key) {
    throw new Error('Missing Supabase environment variables');
  }

  const cookieStore = await cookies();

  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (list) => {
        list.forEach((c) => cookieStore.set(c.name, c.value, c.options));
      },
    },
  });
}

function buildTree(nodes: NodeRow[]): TreeNode[] {
  const map = new Map<
    Id,
    { id: Id; label: string; children: TreeNode[]; parent_id: Id | null }
  >();

  nodes.forEach((n) => {
    map.set(n.id, {
      id: n.id,
      label: n.label,
      children: [],
      parent_id: n.parent_id,
    });
  });

  const roots: TreeNode[] = [];

  map.forEach((node) => {
    if (node.parent_id) {
      const parent = map.get(node.parent_id);
      if (parent) {
        parent.children.push(node as TreeNode);
      }
    } else {
      roots.push(node as TreeNode);
    }
  });

  const stripParent = (n: {
    id: Id;
    label: string;
    children: unknown[];
  }): TreeNode => {
    const { id, label, children } = n;
    return {
      id,
      label,
      children: children.map((child) =>
        stripParent(child as { id: Id; label: string; children: unknown[] }),
      ),
    };
  };

  return roots.map(stripParent);
}

export async function GET() {
  try {
    const supabase = await getClient();
    const { data, error } = await supabase.from('tree_nodes').select('*');
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json(buildTree((data ?? []) as NodeRow[]));
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const { label, parentId } = (await req.json()) as {
      label: string;
      parentId: Id | null;
    };
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('tree_nodes')
      .insert({ label, parent_id: parentId })
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const { id } = (await req.json()) as { id: Id };
    const supabase = await getClient();
    const { data, error } = await supabase
      .from('tree_nodes')
      .delete()
      .eq('id', id)
      .select()
      .single();
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(data);
  } catch (e) {
    if (e instanceof Error) {
      return NextResponse.json({ error: e.message }, { status: 500 });
    }
    return NextResponse.json({ error: 'Unknown error' }, { status: 500 });
  }
}
