import { useRef, useState, type ReactNode } from "react";

const DEFAULT_MAP = 120;
const MIN_MAP = 64;
const MIN_FILE = 180;

export function InspectSplit({
  top,
  bottom,
  expandTop,
}: {
  top: ReactNode;
  bottom: ReactNode;
  expandTop?: boolean;
}) {
  const col = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; h: number } | null>(null);
  const [mapH, setMapH] = useState(DEFAULT_MAP);

  function clamp(next: number): number {
    const colH = col.current?.clientHeight ?? 600;
    return Math.min(colH - MIN_FILE, Math.max(MIN_MAP, next));
  }

  return (
    <aside
      ref={col}
      className={`inspect-column${expandTop ? " expand-map" : ""}`}
      aria-label="Repository and file"
    >
      <div
        className="repo-map-slot"
        style={expandTop ? undefined : { height: mapH }}
      >
        {top}
      </div>
      <div
        className="inspect-split"
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize map"
        aria-valuemin={MIN_MAP}
        aria-valuemax={800}
        aria-valuenow={Math.round(mapH)}
        tabIndex={0}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { y: e.clientY, h: mapH };
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setMapH(clamp(drag.current.h + (e.clientY - drag.current.y)));
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowUp") {
            e.preventDefault();
            setMapH((h) => clamp(h - 16));
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            setMapH((h) => clamp(h + 16));
          }
        }}
      />
      {bottom}
    </aside>
  );
}
