import { createClient } from "@/lib/supabase/server";

export default async function Page() {
  const supabase = await createClient();
  const { data: treeNodes } = await supabase.from("tree_nodes").select();

  return <pre>{JSON.stringify(treeNodes, null, 2)}</pre>;
}
