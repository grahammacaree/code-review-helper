import type { FileEntry } from "../types";
import { Prose } from "../prose";

interface TreeNode {
  name: string;
  path: string;
  children: TreeNode[];
  file?: FileEntry;
}

function buildTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: "", path: "", children: [] };
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let cur = root;
    let acc = "";
    for (let i = 0; i < parts.length; i += 1) {
      const name = parts[i];
      acc = acc ? `${acc}/${name}` : name;
      const isFile = i === parts.length - 1;
      let next = cur.children.find((c) => c.name === name);
      if (!next) {
        next = { name, path: acc, children: [] };
        if (isFile) next.file = file;
        cur.children.push(next);
      } else if (isFile) {
        next.file = file;
      }
      cur = next;
    }
  }
  sortTree(root);
  return root.children;
}

function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aDir = a.file ? 1 : 0;
    const bDir = b.file ? 1 : 0;
    if (aDir !== bDir) return aDir - bDir;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortTree(child);
}

export function RepoMap({
  files,
  queue,
  covered,
  currentPath,
  howItConnects,
}: {
  files: FileEntry[];
  queue: string[];
  covered: string[];
  currentPath?: string;
  howItConnects?: string;
}) {
  const tree = buildTree(files);
  const coveredSet = new Set(covered);
  const queued = new Set(queue);

  return (
    <section className="repo-map" aria-label="Changed files">
      {howItConnects ? (
        <div className="map-blurb">
          <h2>How it connects</h2>
          <Prose text={howItConnects} />
        </div>
      ) : (
        <div className="map-blurb">
          <h2>Changed files</h2>
          {tree.length === 0 && (
            <p className="muted">Checkout a PR to see the tree.</p>
          )}
        </div>
      )}
      {tree.length > 0 && (
        <ul className="tree">
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              currentPath={currentPath}
              covered={coveredSet}
              queued={queued}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function TreeItem({
  node,
  currentPath,
  covered,
  queued,
}: {
  node: TreeNode;
  currentPath?: string;
  covered: Set<string>;
  queued: Set<string>;
}) {
  if (node.file) {
    const path = node.file.path;
    const state = path === currentPath
      ? "current"
      : covered.has(path)
        ? "covered"
        : queued.has(path)
          ? "queued"
          : "other";
    return (
      <li className={`tree-file ${state}`}>
        <code>{node.name}</code>
        <span className="kind">{node.file.kind[0]}</span>
      </li>
    );
  }
  return (
    <li className="tree-dir">
      <span className="dir-name">{node.name}/</span>
      <ul>
        {node.children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            currentPath={currentPath}
            covered={covered}
            queued={queued}
          />
        ))}
      </ul>
    </li>
  );
}
