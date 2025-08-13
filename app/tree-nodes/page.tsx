"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type TreeNode = { id: number; label: string; children: TreeNode[] };

export default function Page() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [parentId, setParentId] = useState("");
  const [label, setLabel] = useState("");

  const loadTree = async () => {
    const res = await fetch("/api/tree");
    const data = await res.json();
    setTree(data);
  };

  const addNode = async () => {
    await fetch("/api/tree", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        parentId: parentId ? Number(parentId) : null,
        label,
      }),
    });
    setParentId("");
    setLabel("");
    loadTree();
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Input
          placeholder="parentId"
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        />
        <Input
          placeholder="label"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Button onClick={addNode}>Add Node</Button>
      </div>

      <Button onClick={loadTree}>Load Trees</Button>
      <pre>{JSON.stringify(tree, null, 2)}</pre>
    </div>
  );
}
